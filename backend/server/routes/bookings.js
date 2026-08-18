/*
/**
 * Endpoints for creating and reading bookings across all
three types. Contains the double-booking prevention
logic: a unique compound MongoDB index ( date +
timeSlot + tableNumber , scoped to active bookings
only) for table reservations, and a transaction-based
overlap check for Function Hall bookings, since their
variable-duration time ranges can’t be covered by a
unique index alone
 */