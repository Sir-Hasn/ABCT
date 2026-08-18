import mongoose from "mongoose";

const menuItemSchema = new mongoose.Schema(
  {
    itemName: { type: String, required: true, trim: true, maxlength: 120 },
    itemDescription: { type: String, required: true, trim: true, maxlength: 1000 },
    itemPrice: { type: Number, required: true, min: 0 },
    itemCategory: { type: String, required: true, trim: true, maxlength: 60 },
    itemPhotoUrl: { type: String, trim: true, default: "" },
    itemAvailable: { type: Boolean, default: true },
    itemNumber: { type: String, required: true, trim: true, unique: true, immutable: true },
  },
  { timestamps: true }
);

const Items = mongoose.model("Items", menuItemSchema);

export { Items };
