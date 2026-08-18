import mongoose from "mongoose";

const bookingSlotSchema = new mongoose.Schema(
  {
    resource: { type: String, required: true, enum: ["function-hall"] },
    slotStart: { type: Date, required: true },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "Bookings",
      immutable: true,
    },
  },
  { timestamps: true }
);

// Only one active Function Hall booking may hold a given one-hour slot.
bookingSlotSchema.index({ resource: 1, slotStart: 1 }, { unique: true });

const BookingSlot = mongoose.model("BookingSlot", bookingSlotSchema);

export { BookingSlot };
