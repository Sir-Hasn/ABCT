import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { isPhilippineMobile, normalizePhilippineMobile } from "../validation/phone.js";

const orderedItemSchema = new mongoose.Schema(
  {
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
    itemName: { type: String, required: true, trim: true },
    // Price snapshots are calculated by the backend at booking time. These
    // fields are optional for compatibility with bookings created earlier.
    baseUnitPrice: { type: Number, min: 0 },
    mealUpgrade: { type: Boolean, default: false },
    mealUpgradeFee: { type: Number, min: 0, default: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    subtotal: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
  {
    userFullName: { type: String, required: true, trim: true, maxlength: 100 },
    userPhone: {
      type: String,
      required: true,
      trim: true,
      maxlength: 30,
      set: (value) => normalizePhilippineMobile(value) || value,
      validate: {
        validator: isPhilippineMobile,
        message: "Phone number must be a Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).",
      },
    },
    userEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^\S+@\S+\.\S+$/,
    },
    bookingType: {
      type: String,
      required: true,
      enum: ["table", "table-with-food", "function-hall"],
    },
    bookingDate: { type: Date, required: true },
    bookingTimeSlot: {
      type: String,
      trim: true,
      required() {
        return this.bookingType !== "function-hall";
      },
    },
    bookingGuestCount: { type: Number, required: true, min: 1, max: 500 },
    bookingStartTime: { type: String, trim: true },
    bookingEndTime: { type: String, trim: true },
    functionHallExtensionHours: { type: Number, min: 0, default: 0 },
    functionHallExtensionFee: { type: Number, min: 0, default: 0 },
    foodOrders: { type: [orderedItemSchema], default: [] },
    foodOrderTotal: { type: Number, min: 0, default: 0 },
    bookingDepositAmount: { type: Number, min: 0, default: 0 },
    bookingStatus: {
      type: String,
      enum: ["pending", "confirmed", "expired", "cancelled"],
      default: "pending",
    },
    bookingDepositStatus: {
      type: String,
      enum: ["unpaid", "paid", "refunded"],
      default: "unpaid",
    },
    bookingNotes: { type: String, trim: true, maxlength: 1000, default: "" },
    bookingID: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: () => `ABCT-${randomUUID()}`,
    },
  },
  { timestamps: true }
);

const Bookings = mongoose.model("Bookings", bookingSchema);

export { Bookings };
