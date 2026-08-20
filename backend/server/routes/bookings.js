import mongoose from "mongoose";
import { Router } from "express";
import { bookingLimiter } from "../middleware/rateLimiter.js";
import { Bookings } from "../models/Booking.js";
import { BookingSlot } from "../models/BookingSlot.js";
import { Items } from "../models/MenuItem.js";
import { normalizePhilippineMobile } from "../validation/phone.js";

const FUNCTION_HALL_MIN_HOURS = 4;
const FUNCTION_HALL_EXTENSION_FEE_PER_HOUR = 5000;
const FUNCTION_HALL_MIN_GUESTS = 30;
const FUNCTION_HALL_MIN_FOOD_TOTAL = 30000;
const TABLE_MENU_MIN_NOTICE_DAYS = 3;
const TABLE_MENU_DEPOSIT_RATE = 0.2;
const HALL_TIME_PATTERN = /^([01]\d|2[0-3]):00$/;
const TABLE_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const bookingsRouter = Router();
const adminBookingsRouter = Router();
const BOOKING_STATUSES = ["pending", "confirmed", "expired", "cancelled"];
const DEPOSIT_STATUSES = ["unpaid", "paid", "refunded"];

function requestError(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isValidDateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isTodayOrFutureDate(value) {
  const requestedDate = dateTextInManila(value);
  const today = dateTextInManila(new Date());
  return isValidDateOnly(requestedDate) && requestedDate >= today;
}

function validatePublicBookingInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw requestError("Request body must be a JSON object.", 400);
  }

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
  } = input;

  if (typeof userFullName !== "string" || !userFullName.trim() || userFullName.length > 100) {
    throw requestError("Guest name is required and must be at most 100 characters.", 400);
  }
  if (typeof userPhone !== "string") {
    throw requestError("Phone number must be text.", 400);
  }
  if (typeof userEmail !== "string" || !/^\S+@\S+\.\S+$/.test(userEmail.trim())) {
    throw requestError("A valid email address is required.", 400);
  }
  if (!["table", "table-with-food", "function-hall"].includes(bookingType)) {
    throw requestError("Booking type is invalid.", 400);
  }
  if (!isValidDateOnly(bookingDate)) {
    throw requestError("Booking date must use a valid YYYY-MM-DD date.", 400);
  }
  if (!isTodayOrFutureDate(bookingDate)) {
    throw requestError("Booking date cannot be in the past.", 422);
  }
  if (!Number.isInteger(bookingGuestCount) || bookingGuestCount < 1 || bookingGuestCount > 500) {
    throw requestError("Guest count must be a whole number from 1 to 500.", 400);
  }
  if (bookingType !== "function-hall" && (typeof bookingTimeSlot !== "string" || !TABLE_TIME_PATTERN.test(bookingTimeSlot))) {
    throw requestError("Booking time slot must use a valid HH:MM time.", 400);
  }
  for (const time of [bookingStartTime, bookingEndTime]) {
    if (time !== undefined && typeof time !== "string") {
      throw requestError("Booking times must be text.", 400);
    }
  }
  if (bookingNotes !== undefined && (typeof bookingNotes !== "string" || bookingNotes.length > 1000)) {
    throw requestError("Booking notes must be text with at most 1,000 characters.", 400);
  }
  if (selectedMenuItems !== undefined && !Array.isArray(selectedMenuItems)) {
    throw requestError("selectedMenuItems must be an array.", 400);
  }
}

function parseFunctionHallSchedule(bookingDate, bookingStartTime, bookingEndTime) {
  const dateText = typeof bookingDate === "string" ? bookingDate.slice(0, 10) : "";
  if (!isValidDateOnly(dateText) || !isTodayOrFutureDate(dateText) || !HALL_TIME_PATTERN.test(bookingStartTime) || !HALL_TIME_PATTERN.test(bookingEndTime)) {
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

function dateTextInManila(value) {
  if (typeof value === "string") return value.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date(value));
}

function hasTableMenuNotice(bookingDate) {
  const requestedDate = dateTextInManila(bookingDate);
  const today = dateTextInManila(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    return false;
  }

  const requestedUtc = Date.parse(`${requestedDate}T00:00:00Z`);
  const todayUtc = Date.parse(`${today}T00:00:00Z`);
  return requestedUtc - todayUtc >= TABLE_MENU_MIN_NOTICE_DAYS * 24 * 60 * 60 * 1000;
}

function calculateTableMenuDeposit(foodOrderTotal) {
  return Math.round(foodOrderTotal * TABLE_MENU_DEPOSIT_RATE * 100) / 100;
}

function buildFunctionHallSlots(start, end, bookingId) {
  const slots = [];
  for (let slotStart = new Date(start); slotStart < end; slotStart.setUTCHours(slotStart.getUTCHours() + 1)) {
    slots.push({ resource: "function-hall", slotStart: new Date(slotStart), bookingId });
  }
  return slots;
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
    validatePublicBookingInput(request.body);

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

    const normalizedPhone = normalizePhilippineMobile(userPhone);
    if (!normalizedPhone) {
      throw requestError("Phone number must be a Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).");
    }

    const guestCount = Number(bookingGuestCount);
    let bookingData = {
      userFullName,
      userPhone: normalizedPhone,
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

    const tableMenuOrder = await buildFoodOrder(selectedMenuItems);
    if (tableMenuOrder.foodOrders.length > 0 && !hasTableMenuNotice(bookingDate)) {
      throw requestError("Table bookings with menu orders must be requested at least 3 days in advance.");
    }

    bookingData = {
      ...bookingData,
      ...tableMenuOrder,
      bookingDepositAmount: calculateTableMenuDeposit(tableMenuOrder.foodOrderTotal),
    };

    const booking = await Bookings.create(bookingData);
    response.status(201).json({
      message: "Booking request received.",
      booking: {
        bookingID: booking.bookingID,
        bookingStatus: booking.bookingStatus,
        bookingDepositStatus: booking.bookingDepositStatus,
        foodOrderTotal: booking.foodOrderTotal,
        bookingDepositAmount: booking.bookingDepositAmount,
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
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) {
      throw requestError("Request body must be a JSON object.", 400);
    }

    const { bookingId } = request.params;
    const {
      bookingStatus,
      bookingDepositStatus,
      bookingNotes,
      userFullName,
      userPhone,
      userEmail,
      bookingDate,
      bookingTimeSlot,
      bookingGuestCount,
      bookingStartTime,
      bookingEndTime,
    } = request.body;

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
    if (userFullName !== undefined && (typeof userFullName !== "string" || !userFullName.trim() || userFullName.length > 100)) {
      throw requestError("Guest name is required and must be at most 100 characters.", 400);
    }
    const normalizedPhone = userPhone === undefined ? undefined : normalizePhilippineMobile(userPhone);
    if (userPhone !== undefined && !normalizedPhone) {
      throw requestError("Phone number must be a Philippine mobile number (09XXXXXXXXX or +639XXXXXXXXX).", 400);
    }
    if (userEmail !== undefined && (typeof userEmail !== "string" || !/^\S+@\S+\.\S+$/.test(userEmail.trim()))) {
      throw requestError("A valid email address is required.", 400);
    }
    if (bookingDate !== undefined && !isValidDateOnly(bookingDate)) {
      throw requestError("Booking date must use a valid YYYY-MM-DD date.", 400);
    }
    if (bookingTimeSlot !== undefined && (typeof bookingTimeSlot !== "string" || !TABLE_TIME_PATTERN.test(bookingTimeSlot))) {
      throw requestError("Booking time slot must use a valid HH:MM time.", 400);
    }
    if (bookingGuestCount !== undefined && (!Number.isInteger(bookingGuestCount) || bookingGuestCount < 1 || bookingGuestCount > 500)) {
      throw requestError("Guest count must be a whole number from 1 to 500.", 400);
    }
    for (const time of [bookingStartTime, bookingEndTime]) {
      if (time !== undefined && typeof time !== "string") {
        throw requestError("Booking times must be text.", 400);
      }
    }
    const scheduleWasEdited = [bookingDate, bookingStartTime, bookingEndTime].some((value) => value !== undefined);
    const detailsWereEdited = [userFullName, userPhone, userEmail, bookingDate, bookingTimeSlot, bookingGuestCount, bookingStartTime, bookingEndTime].some((value) => value !== undefined);
    if (bookingStatus === undefined && bookingDepositStatus === undefined && bookingNotes === undefined && !detailsWereEdited) {
      throw requestError("Provide a booking status, deposit status, notes, or booking detail update.", 400);
    }

    session = await mongoose.startSession();
    let updatedBooking;
    await session.withTransaction(async () => {
      const booking = await Bookings.findById(bookingId).session(session);
      if (!booking) {
        throw requestError("Booking not found.", 404);
      }

      const nextGuestCount = bookingGuestCount ?? booking.bookingGuestCount;
      const nextStatus = bookingStatus ?? booking.bookingStatus;
      const terminalTarget = ["expired", "cancelled"].includes(nextStatus);
      const nextDate = bookingDate ?? dateTextInManila(booking.bookingDate);
      if ((!terminalTarget || bookingDate !== undefined) && !isTodayOrFutureDate(nextDate)) {
        throw requestError("Booking date cannot be in the past.", 422);
      }

      if (booking.bookingType === "function-hall") {
        if (scheduleWasEdited || !terminalTarget) {
          const nextStart = bookingStartTime ?? booking.bookingStartTime;
          const nextEnd = bookingEndTime ?? booking.bookingEndTime;
          const { durationHours } = parseFunctionHallSchedule(nextDate, nextStart, nextEnd);
          if (!terminalTarget && nextGuestCount < FUNCTION_HALL_MIN_GUESTS && Number(booking.foodOrderTotal || 0) < FUNCTION_HALL_MIN_FOOD_TOTAL) {
            throw requestError("Function Hall bookings need at least 30 guests or a ₱30,000 menu order total.", 422);
          }
          if (scheduleWasEdited) {
            booking.functionHallExtensionHours = durationHours - FUNCTION_HALL_MIN_HOURS;
            booking.functionHallExtensionFee = (durationHours - FUNCTION_HALL_MIN_HOURS) * FUNCTION_HALL_EXTENSION_FEE_PER_HOUR;
          }
        }
      } else {
        const nextTimeSlot = bookingTimeSlot ?? booking.bookingTimeSlot;
        if (typeof nextTimeSlot !== "string" || !TABLE_TIME_PATTERN.test(nextTimeSlot)) {
          throw requestError("Booking time slot must use a valid HH:MM time.", 422);
        }
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

      if (userFullName !== undefined) booking.userFullName = userFullName.trim();
      if (normalizedPhone !== undefined) booking.userPhone = normalizedPhone;
      if (userEmail !== undefined) booking.userEmail = userEmail.trim().toLowerCase();
      if (bookingGuestCount !== undefined) booking.bookingGuestCount = bookingGuestCount;
      if (bookingTimeSlot !== undefined) booking.bookingTimeSlot = bookingTimeSlot.trim();
      if (bookingDate !== undefined) booking.bookingDate = new Date(`${bookingDate}T00:00:00+08:00`);
      if (bookingStartTime !== undefined) booking.bookingStartTime = bookingStartTime.trim();
      if (bookingEndTime !== undefined) booking.bookingEndTime = bookingEndTime.trim();

      if (scheduleWasEdited && booking.bookingType === "function-hall") {
        const nextDate = dateTextInManila(bookingDate ?? booking.bookingDate);
        const nextStart = bookingStartTime ?? booking.bookingStartTime;
        const nextEnd = bookingEndTime ?? booking.bookingEndTime;
        const { start, end, durationHours } = parseFunctionHallSchedule(nextDate, nextStart, nextEnd);
        booking.functionHallExtensionHours = durationHours - FUNCTION_HALL_MIN_HOURS;
        booking.functionHallExtensionFee = (durationHours - FUNCTION_HALL_MIN_HOURS) * FUNCTION_HALL_EXTENSION_FEE_PER_HOUR;
        await BookingSlot.deleteMany({ bookingId: booking._id }).session(session);
        if (!['expired', 'cancelled'].includes(nextStatus)) {
          await BookingSlot.insertMany(buildFunctionHallSlots(start, end, booking._id), { session, ordered: true });
        }
      }

      updatedBooking = await booking.save({ session });
    });

    response.status(200).json({
      message: "Booking updated.",
      booking: updatedBooking,
    });
  } catch (error) {
    if (error.code === 11000) {
      return response.status(409).json({ message: "The Function Hall is already requested for part of that time range." });
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

export { bookingsRouter, adminBookingsRouter };
