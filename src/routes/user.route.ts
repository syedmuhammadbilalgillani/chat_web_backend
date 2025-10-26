import express from "express";
import {
  registerUser,
  loginUser,
  getUsers,
  getUser,
  updateUser,
  deleteUser,
  getOtherUsers,
} from "../controllers/auth.controller";
import { protect } from "../middlewares/authMiddleware";

const router = express.Router();

// Public routes
router.post("/register", registerUser);
router.post("/login", loginUser);

// Protected routes
router.get("/", protect, getUsers);
router.get("/other", protect, getOtherUsers);
router.get("/:id", protect, getUser);
router.put("/:id", protect, updateUser);
router.delete("/:id", protect, deleteUser);

export default router;
