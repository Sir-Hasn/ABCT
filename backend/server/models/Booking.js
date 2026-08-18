/**
 * Mongoose schema for bookings: type ,
customerName , phone , email , date ,
timeSlot / tableNumber (table) or
startTime / endTime (Function Hall), partySize ,
status , depositStatus , notes , timestamps — plus
the unique index definition
 */
import mongoose from "mongoose";
const bookings = mongoose.model("Bookings", new mongoose.Schema({
    userFullName: {},
    userPhone: {},
    userEmail: {},
    bookingType: {}, // table, table w food, function hall, catering service
    bookingDate: {}, // table: can be same day booking, table w food: 3 days before booking, function hall: 7 days before booking, catering service: 7 days before booking
    bookingTimeSlot: {}, // table: 1-hour slot, table w food: 1-hour slot, function hall: start time, catering service: start time
    bookingGuestCount: {}, // table: number of guests, table w food: number of guests, function hall: number of guests, catering service: number of guests
    bookingStartTime: {}, // function hall: start time, catering service: start time
    bookingEndTime: {}, // function hall: end time, catering service: end time
    bookingStatus: {}, // pending / confirmed / cancelled
    bookingDepositStatus: {}, // paid / unpaid
    bookingNotes: {}, // optional notes from the customer
    bookingID: {} // unique booking ID for reference
})
); export { Bookings };