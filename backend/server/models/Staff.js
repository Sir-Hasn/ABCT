import mongoose from "mongoose";

const staffSchema = new mongoose.Schema(
  {
    userName: { type: String, required: true, trim: true, maxlength: 80 },
    userEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      match: /^\S+@\S+\.\S+$/,
    },
    // This stores a bcrypt hash, never a plain-text password.
    userPassword: { type: String, required: true, select: false },
    userRole: { type: String, enum: ["admin", "staff"], default: "staff" },
  },
  { timestamps: true }
);

const User = mongoose.model("User", staffSchema);

export { User };
