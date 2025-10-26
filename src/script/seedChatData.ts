// scripts/seedChatData.ts
import mongoose from 'mongoose';
import { User, Conversation, Message } from '../schema';
import bcrypt from 'bcryptjs';

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chatApp';

async function seedChatData() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Clean existing data (optional)
    await User.deleteMany({});
    await Conversation.deleteMany({});
    await Message.deleteMany({});
    console.log('🧹 Existing data cleared');

    // Create sample users
    const password = await bcrypt.hash('123456', 10);
    const users = await User.insertMany([
      {
        username: 'Alice',
        email: 'alice@example.com',
        password,
        profilePicture: 'https://randomuser.me/api/portraits/women/1.jpg',
        isActive: true,
      },
      {
        username: 'Bob',
        email: 'bob@example.com',
        password,
        profilePicture: 'https://randomuser.me/api/portraits/men/1.jpg',
        isActive: true,
      },
      {
        username: 'Charlie',
        email: 'charlie@example.com',
        password,
        profilePicture: 'https://randomuser.me/api/portraits/men/2.jpg',
        isActive: false,
      },
    ]);

    console.log(
      '👤 Users created:',
      users.map((u) => u.username),
    );

    // Create a private conversation between Alice and Bob
    const conversation = await Conversation.create({
      type: 'private',
      participants: [{ userId: users[0]._id }, { userId: users[1]._id }],
    });
    console.log(conversation, 'conversation');
    console.log('💬 Private conversation created between Alice & Bob');

    // Create some messages between them
    const messages = await Message.insertMany([
      {
        conversationId: conversation._id,
        senderId: users[0]._id,
        text: 'Hey Bob! How are you?',
      },
      {
        conversationId: conversation._id,
        senderId: users[1]._id,
        text: "Hey Alice, I'm doing great! What about you?",
      },
      {
        conversationId: conversation._id,
        senderId: users[0]._id,
        text: "I'm good too. Let's catch up later.",
      },
    ]);

    console.log('📨 Messages created:', messages.length);

    // Update conversation lastMessage
    await Conversation.findByIdAndUpdate(conversation._id, {
      lastMessage: {
        messageId: messages[messages.length - 1]._id,
        text: messages[messages.length - 1].text,
        sentAt: messages[messages.length - 1].createdAt,
      },
    });

    console.log('🗨️ Last message linked to conversation');

    console.log('✅ Seeding completed successfully');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error seeding data:', err);
    process.exit(1);
  }
}

seedChatData();
