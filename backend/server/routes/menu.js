import mongoose from "mongoose";
import { Router } from "express";
import { Items } from "../models/MenuItem.js";

const menuRouter = Router();
const adminMenuRouter = Router();

function requestError(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validatePhotoUrl(itemPhotoUrl) {
  if (itemPhotoUrl === undefined || itemPhotoUrl === "") {
    return;
  }

  try {
    const photoUrl = new URL(itemPhotoUrl);
    if (photoUrl.protocol !== "https:" || photoUrl.hostname !== "res.cloudinary.com") {
      throw new Error();
    }
  } catch {
    throw requestError("itemPhotoUrl must be an HTTPS Cloudinary delivery URL.");
  }
}

function validateItemId(itemId) {
  if (!mongoose.isValidObjectId(itemId)) {
    throw requestError("Invalid menu item ID.", 400);
  }
}

// Public menu: unavailable items remain visible only to admin endpoints.
menuRouter.get("/", async (_request, response, next) => {
  try {
    const items = await Items.find({ itemAvailable: true })
      .sort({ itemCategory: 1, itemName: 1 })
      .lean();

    response.status(200).json({ items });
  } catch (error) {
    next(error);
  }
});

adminMenuRouter.get("/", async (_request, response, next) => {
  try {
    const items = await Items.find({}).sort({ itemCategory: 1, itemName: 1 }).lean();
    response.status(200).json({ items });
  } catch (error) {
    next(error);
  }
});

adminMenuRouter.post("/", async (request, response, next) => {
  try {
    const {
      itemName,
      itemDescription,
      itemPrice,
      itemCategory,
      itemPhotoUrl,
      itemAvailable,
      itemNumber,
    } = request.body;
    validatePhotoUrl(itemPhotoUrl);

    const item = await Items.create({
      itemName,
      itemDescription,
      itemPrice,
      itemCategory,
      itemPhotoUrl,
      itemAvailable,
      itemNumber,
    });
    response.status(201).json({ message: "Menu item created.", item });
  } catch (error) {
    if (error.code === 11000) {
      return response.status(409).json({ message: "That item number is already in use." });
    }
    if (error.status) {
      return response.status(error.status).json({ message: error.message });
    }
    if (error.name === "ValidationError") {
      return response.status(422).json({
        message: "Please check the menu item details and try again.",
        errors: Object.values(error.errors).map((item) => item.message),
      });
    }
    next(error);
  }
});

adminMenuRouter.patch("/:itemId", async (request, response, next) => {
  try {
    validateItemId(request.params.itemId);
    const allowedFields = ["itemName", "itemDescription", "itemPrice", "itemCategory", "itemPhotoUrl"];
    const updates = Object.fromEntries(
      allowedFields
        .filter((field) => request.body[field] !== undefined)
        .map((field) => [field, request.body[field]])
    );
    if (Object.keys(updates).length === 0) {
      throw requestError("Provide at least one menu field to update.", 400);
    }
    validatePhotoUrl(updates.itemPhotoUrl);

    const item = await Items.findByIdAndUpdate(request.params.itemId, updates, {
      returnDocument: "after",
      runValidators: true,
    });
    if (!item) {
      throw requestError("Menu item not found.", 404);
    }
    response.status(200).json({ message: "Menu item updated.", item });
  } catch (error) {
    if (error.status) {
      return response.status(error.status).json({ message: error.message });
    }
    if (error.name === "ValidationError") {
      return response.status(422).json({
        message: "Please check the menu item details and try again.",
        errors: Object.values(error.errors).map((item) => item.message),
      });
    }
    next(error);
  }
});

adminMenuRouter.patch("/:itemId/availability", async (request, response, next) => {
  try {
    validateItemId(request.params.itemId);
    if (typeof request.body.itemAvailable !== "boolean") {
      throw requestError("itemAvailable must be true or false.", 400);
    }

    const item = await Items.findByIdAndUpdate(
      request.params.itemId,
      { itemAvailable: request.body.itemAvailable },
      { returnDocument: "after", runValidators: true }
    );
    if (!item) {
      throw requestError("Menu item not found.", 404);
    }
    response.status(200).json({ message: "Menu availability updated.", item });
  } catch (error) {
    if (error.status) {
      return response.status(error.status).json({ message: error.message });
    }
    next(error);
  }
});

export { menuRouter, adminMenuRouter };
