import bodyParser from 'body-parser';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import { Socket, Server as SocketIOServer } from 'socket.io';
import connectDB from './lib/db';
import { Conversation, Message, User } from '../src/schema';
import { errorHandler } from './middlewares/errorHandler';
import chatRoutes from './routes/chat.route';
import router from './routes/user.route';
import { setupSocket } from './sockets/socketHandler';
import { verifyToken } from './controllers/auth.controller';

dotenv.config();
const app = express();
const PORT = process.env.PORT || 5235;
const HOST = 'localhost';

// Middleware
app.use(express.json());
const allowedOrigins =
  process.env.NODE_ENV === 'production' ? ['https://yourdomain.com'] : ['http://localhost:3000'];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);
app.use(bodyParser.json());
app.use(cookieParser());
app.use(bodyParser.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  // Log headers and body if needed, but avoid logging 'res'
  // console.log('Request Headers:', req.headers);
  console.log('Request Body:', req.body);
  next();
});
// Error logging and handling
app.use(errorHandler);

// Routes logging
app.use(
  '/api/auth',
  (req, res, next) => {
    console.log('Auth route hit');
    next();
    // console.log('Auth route res', res);
  },
  router,
);

app.use(
  '/api/chats',
  (req, res: any, next) => {
    console.log('Chats route hit');
    next();
    console.log(res?.data, 'res');
  },
  chatRoutes,
);

app.get('/', (req, res) => {
  res.send('Server Working...!!!');
});

// Connect to DB and log connection status
if (process.env.NODE_ENV !== 'production') {
  connectDB()
    .then(() => {
      console.log('DB Connected');
    })
    .catch((err) => {
      console.error('DB Connection Failed', err);
    });
} else {
  connectDB().catch((err) => {
    console.error('DB Connection Failed', err);
  });
}

// Create server and socket.io
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: 'http://localhost:3000', // Specify the exact origin
    methods: ['GET', 'POST'],
    credentials: true, // Allow credentials for Socket.IO
  },
});
io.use(async (socket, next) => {
  let token: string | undefined;

  // ✅ 1️⃣ Check auth field (recommended way for Socket.IO)
  if (socket.handshake.auth?.token) {
    token = socket.handshake.auth.token;
    console.log('Token from handshake.auth:', token);
  }

  // ✅ 2️⃣ Check Authorization header
  if (!token && socket.handshake.headers?.authorization) {
    const authHeader = socket.handshake.headers.authorization.trim();

    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
      console.log('Token from Bearer header:', token);
    } else if (authHeader.startsWith('token=')) {
      token = authHeader.split('token=')[1];
      console.log('Token from token= header:', token);
    }
  }

  // ✅ 3️⃣ Check cookies
  if (!token && socket.handshake.headers?.cookie) {
    const cookies = socket.handshake.headers.cookie.split(';').map((c) => c.trim());

    const tokenCookie = cookies.find((c) => c.startsWith('token='));
    if (tokenCookie) {
      token = tokenCookie.split('token=')[1];
      console.log('Token from cookies:', token);
    }
  }

  // ✅ 4️⃣ If still no token found
  if (!token) {
    console.error('Authentication error: token required');
    return next(new Error('Authentication error: token required'));
  }

  // ✅ 5️⃣ Verify and attach user
  try {
    console.log('sending token to verify for socket', token);

    const decoded = verifyToken(token) as {
      id: string;
      email: string;
      password: string;
    };
    const user = await User.findById(decoded.id).select('-password');

    if (!user) {
      console.error('Authentication error: user not found');
      return next(new Error('Authentication error: user not found'));
    }

    (socket as any).user = user;
    next();
  } catch (err) {
    console.error('Authentication error: invalid token', err);
    next(new Error('Authentication error: invalid token'));
  }
});
// Socket connection and logging
io.on('connection', (socket: Socket) => {
  const user = (socket as any).user;
  if (!user) return;

  console.log(`🔌 User connected: ${user._id} socketId=${socket.id}`);

  // Mark user active & save socket id
  User.findByIdAndUpdate(user._id, { isActive: true, socketId: socket.id }).exec();

  // Join user-specific room for direct messages / notifications
  socket.join(user._id.toString());

  // Broadcast online to others
  socket.broadcast.emit('user:online', { userId: user._id });

  // Handle sending messages
  socket.on('message:send', async (payload: any, cb?: Function) => {
    try {
      const senderId = user._id;
      let conversationId = payload.conversationId;

      // If conversationId not provided, create or find a private conversation
      if (!conversationId && payload.to) {
        const existing = await Conversation.findOne({
          type: 'private',
          'participants.userId': { $all: [senderId, payload.to] },
        });
        if (existing) conversationId = existing._id;
        else {
          const conv = await Conversation.create({
            type: 'private',
            participants: [{ userId: senderId }, { userId: payload.to }],
          });
          conversationId = conv._id;
        }
      }

      if (!conversationId) {
        return cb?.({ status: 'error', message: 'conversationId or to required' });
      }

      const msg = await Message.create({
        conversationId,
        senderId,
        text: payload.text,
        attachments: payload.attachments || [],
      });

      // Update conversation lastMessage
      await Conversation.findByIdAndUpdate(conversationId, {
        lastMessage: { messageId: msg._id, text: msg.text, sentAt: msg.createdAt },
        updatedAt: new Date(),
      });

      // Emit to all participants in that conversation
      const conv = await Conversation.findById(conversationId).lean();
      if (conv) {
        for (const p of conv.participants) {
          if (p.deletedAt) continue;
          io.to(p.userId.toString()).emit('message:received', msg);
        }
      }

      cb?.({ status: 'ok', message: msg });
    } catch (err) {
      console.error('message:send error', err);
      cb?.({ status: 'error', message: 'server error' });
    }
  });

  // Message seen
  socket.on('message:seen', async ({ messageId }: { messageId: string }) => {
    try {
      const meId = user._id;
      const msg = await Message.findById(messageId);
      if (!msg) return;

      // Add to seenBy
      if (!msg.seenBy.map(String).includes(meId.toString())) {
        msg.seenBy.push(meId);
        await msg.save();

        // Notify sender that message is seen
        io.to(msg.senderId.toString()).emit('message:seen', { messageId, by: meId });
      }
    } catch (err) {
      console.error('message:seen error', err);
    }
  });

  // Delete for me
  socket.on('message:deleteForMe', async ({ messageId }: { messageId: string }) => {
    try {
      const meId = user._id;
      await Message.updateOne({ _id: messageId }, { $addToSet: { deletedFor: meId } });
      socket.emit('message:deletedForMe', { messageId });
    } catch (err) {
      console.error('message:deleteForMe error', err);
    }
  });

  // Delete for everyone
  socket.on('message:deleteForEveryone', async ({ messageId }: { messageId: string }) => {
    try {
      const meId = user._id;
      const msg = await Message.findById(messageId);
      if (!msg) return;
      if (msg.senderId.toString() !== meId.toString()) {
        return socket.emit('error', { message: 'Only sender can delete for everyone' });
      }
      msg.isDeletedForEveryone = true;
      await msg.save();

      // Notify participants
      const conv = await Conversation.findById(msg.conversationId);
      if (!conv) return;
      for (const p of conv.participants) {
        io.to(p.userId.toString()).emit('message:deletedForEveryone', { messageId });
      }
    } catch (err) {
      console.error('message:deleteForEveryone error', err);
    }
  });

  // Delete conversation for this user
  socket.on('conversation:deleteForMe', async ({ conversationId }: { conversationId: string }) => {
    try {
      const meId = user._id;
      const conv = await Conversation.findById(conversationId);
      if (!conv) return;
      conv.participants = conv.participants.map((p) => {
        if (p.userId.toString() === meId.toString()) p.deletedAt = new Date();
        return p;
      });
      await conv.save();
      socket.emit('conversation:deletedForMe', { conversationId });
    } catch (err) {
      console.error('conversation:deleteForMe error', err);
    }
  });

  // Disconnect handling - set lastSeen & isActive false
  socket.on('disconnect', async () => {
    try {
      await User.findByIdAndUpdate(user._id, {
        isActive: false,
        lastSeen: new Date(),
        socketId: null,
      });
      socket.broadcast.emit('user:offline', { userId: user._id, lastSeen: new Date() });
      console.log(`🔌 User disconnected: ${user._id}`);
    } catch (err) {
      console.error('disconnect error', err);
    }
  });
});

// Set up socket events
setupSocket(io);

// Server listen and logging
server.listen(Number(PORT), HOST, () => {
  console.log(`✅ Server is running on http://${HOST}:${PORT}`);
});
