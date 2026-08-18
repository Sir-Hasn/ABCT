import mongoose from "mongoose";
import { Router } from "express";
import { bookingLimiter } from "../middleware/rateLimiter.js";
import { Bookings } from "../models/Booking.js";
import { BookingSlot } from "../models/BookingSlot.js";
import { Items } from "../models/MenuItem.js";

const FUNCTION_HALL_MIN_HOURS = 4;
const FUNCTION_HALL_EXTENSION_FEE_PER_HOUR = 5000;
const FUNCTION_HALL_MIN_GUESTS = 30;
const FUNCTION_HALL_MIN_FOOD_TOTAL = 30000;
const HALL_TIME_PATTERN = /^([01]\d|2[0-3]):00$/;
const bookingsRouter = Router();
const adminBookingsRouter = Router();
const BOOKING_STATUSES = ["pending", "confirmed", "expired", "cancelled"];
const DEPOSIT_STATUSES = ["unpaid", "paid", "refunded"];

function requestError(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseFunctionHallSchedule(bookingDate, bookingStartTime, bookingEndTime) {
  const dateText = typeof bookingDate === "string" ? bookingDate.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText) || !HALL_TIME_PATTERN.test(bookingStartTime) || !HALL_TIME_PATTERN.test(bookingEndTime)) {
    throw requestError("Function Hall date and times must use YYYY-MM-DD and whole-hour HH:00 values.");
  }

  const start = new Date(`${dateText}T${bookingStartTime}:00+08:00`);
  const end = new Date(`${dateText}T${bookingEndTime}:00+08:00`);
  const durationHours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);

  if (!Number.isInteger(durationHours) || durationHours < FUNCTION_HALL_MIN_HOURS) {
    throw requestError("Function Hall bookings must be at least 4 hours.");
  }

  return { start, end, durationHours };
}

async function buildFoodOrder(selectedMenuItems) {
  if (selectedMenuItems === undefined) {
    return { foodOrders: [], foodOrderTotal: 0 };
  }

  if (!Array.isArray(selectedMenuItems)) {
    throw requestError("selectedMenuItems must be an array.");
  }

  const quantitiesById = new Map();
  for (const selection of selectedMenuItems) {
    const itemId = selection?.itemId;
    const quantity = selection?.quantity;
    if (!mongoose.isValidObjectId(itemId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      throw requestError("Each selected menu item needs a valid itemId and quantity from 1 to 100.");
    }
    if (quantitiesById.has(itemId)) {
      throw requestError("Each menu item can be selected only once.");
    }
    quantitiesById.set(itemId, quantity);
  }

  const itemIds = [...quantitiesById.keys()];
  const menuItems = await Items.find({ _id: { $in: itemIds }, itemAvailable: true }).lean();
  if (menuItems.length !== itemIds.length) {
    throw requestError("One or more selected menu items are unavailable.");
  }

  const foodOrders = menuItems.map((item) => {
    const quantity = quantitiesById.get(item._id.toString());
    const subtotal = item.itemPrice * quantity;
    return {
      itemId: item._id,
      itemName: item.itemName,
      unitPrice: item.itemPrice,
      quantity,
      subtotal,
    };
  });
  const foodOrderTotal = foodOrders.reduce((total, item) => total + item.subtotal, 0);

  return { foodOrders, foodOrderTotal };
}

bookingsRouter.post("/", bookingLimiter, async (request, response, next) => {
  let session;
  try {
    const {
      userFullName,
      userPhone,
      userEmail,
      bookingType,
      bookingDate,
      bookingTimeSlot,
      bookingGuestCount,
      bookingStartTime,
      bookingEndTime,
      bookingNotes,
      selectedMenuItems,
    } = request.body;

    const guestCount = Number(bookingGuestCount);
    let bookingData = {
      userFullName,
      userPhone,
      userEmail,
      bookingType,
      bookingDate,
      bookingTimeSlot,
      bookingGuestCount: guestCount,
      bookingStartTime,
      bookingEndTime,
      bookingNotes,
    };

    if (bookingType === "function-hall") {
      const { start, end, durationHours } = parseFunctionHallSchedule(
        bookingDate,
        bookingStartTime,
        bookingEndTime
      );
      const { foodOrders, foodOrderTotal } = await buildFoodOrder(selectedMenuItems);

      if (guestCount < FUNCTION_HALL_MIN_GUESTS && foodOrderTotal < FUNCTION_HALL_MIN_FOOD_TOTAL) {
        throw requestError("Function Hall bookings need at least 30 guests or a ₱30,000 menu order total.");
      }

      bookingData = {
        ...bookingData,
        bookingTimeSlot: undefined,
        functionHallExtensionHours: durationHours - FUNCTION_HALL_MIN_HOURS,
        functionHallExtensionFee: (durationHours - FUNCTION_HALL_MIN_HOURS) * FUNCTION_HALL_EXTENSION_FEE_PER_HOUR,
        foodOrders,
        foodOrderTotal,
      };

      const slotDocuments = [];
      for (let slotStart = new Date(start); slotStart < end; slotStart.setUTCHours(slotStart.getUTCHours() + 1)) {
        slotDocuments.push({ resource: "function-hall", slotStart: new Date(slotStart) });
      }

      session = await mongoose.startSession();
      let booking;
      await session.withTransaction(async () => {
        [booking] = await Bookings.create([bookingData], { session });
        await BookingSlot.insertMany(
          slotDocuments.map((slot) => ({ ...slot, bookingId: booking._id })),
          { session, ordered: true }
        );
      });

      return response.status(201).json({
        message: "Function Hall booking request received.",
        booking: {
          bookingID: booking.bookingID,
          bookingStatus: booking.bookingStatus,
          foodOrderTotal: booking.foodOrderTotal,
          functionHallExtensionHours: booking.functionHallExtensionHours,
          functionHallExtensionFee: booking.functionHallExtensionFee,
        },
      });
    }

    const booking = await Bookings.create(bookingData);
    response.status(201).json({
      message: "Booking request received.",
      booking: {
        bookingID: booking.bookingID,
        bookingStatus: booking.bookingStatus,
        bookingDepositStatus: booking.bookingDepositStatus,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return response.status(409).json({
        message: "The Function Hall is already requested for part of that time range.",
      });
    }
    if (error.status) {
      return response.status(error.status).json({ message: error.message });
    }
    if (error.name === "ValidationError") {
      return response.status(422).json({
        message: "Please check the booking details and try again.",
        errors: Object.values(error.errors).map((item) => item.message),
      });
    }
    next(error);
  } finally {
    if (session) {
      await session.endSession();
    }
  }
});

adminBookingsRouter.get("/", async (request, response, next) => {
  try {
    const status = request.query.status;
    if (status && !BOOKING_STATUSES.includes(status)) {
      throw requestError("Invalid booking status filter.", 400);
    }

    const bookings = await Bookings.find(status ? { bookingStatus: status } : {})
      .sort({ bookingDate: 1, bookingStartTime: 1, createdAt: -1 })
      .limit(100)
      .lean();
    response.status(200).json({ bookings });
  } catch (error) {
    if (error.status) {
      return response.status(error.status).json({ message: error.message });
    }
    next(error);
  }
});

adminBookingsRouter.patch("/:bookingId", async (request, response, next) => {
  let session;
  try {
    const { bookingId } = request.params;
    const { bookingStatus, bookingDepositStatus, bookingNotes } = request.body;

    if (!mongoose.isValidObjectId(bookingId)) {
      throw requestError("Invalid booking ID.", 400);
    }
    if (bookingStatus !== undefined && !BOOKING_STATUSES.includes(bookingStatus)) {
      throw requestError("Invalid booking status.", 400);
    }
    if (bookingDepositStatus !== undefined && !DEPOSIT_STATUSES.includes(bookingDepositStatus)) {
      throw requestError("Invalid deposit status.", 400);
    }
    if (bookingNotes !== undefined && (typeof bookingNotes !== "string" || bookingNotes.length > 1000)) {
      throw requestError("Notes must be text with at most 1,000 characters.", 400);
    }
    if (bookingStatus === undefined && bookingDepositStatus === undefined && bookingNotes === undefined) {
      throw requestError("Provide a booking status, deposit status, or notes update.", 400);
    }

    session = await mongoose.startSession();
    let updatedBooking;
    await session.withTransaction(async () => {
      const booking = await Bookings.findById(bookingId).session(session);
      if (!booking) {
        throw requestError("Booking not found.", 404);
      }

      if (bookingStatus && bookingStatus !== booking.bookingStatus) {
        const terminalStatuses = ["expired", "cancelled"];
        if (terminalStatuses.includes(booking.bookingStatus)) {
          throw requestError("Expired or cancelled bookings cannot be reactivated.", 409);
        }

        booking.bookingStatus = bookingStatus;
        if (booking.bookingType === "function-hall" && terminalStatuses.includes(bookingStatus)) {
          await BookingSlot.deleteMany({ bookingId: booking._id }).session(session);
        }
      }

      if (bookingDepositStatus !== undefined) {
        booking.bookingDepositStatus = bookingDepositStatus;
      }
      if (bookingNotes !== undefined) {
        booking.bookingNotes = bookingNotes;
      }

      updatedBooking = await booking.save({ session });
    });

    response.status(200).json({
      message: "Booking updated.",
      booking: updatedBooking,
    });
  } catch (error) {
    if (error.status) {
      return response.status(error.status).json({ message: error.message });
    }
    next(error);
  } finally {
    if (session) {
      await session.endSession();
    }
  }
});

export { bookingsRouter, adminBookingsRouter };
