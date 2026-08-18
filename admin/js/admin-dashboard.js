/*
Core dashboard logic, built on a single-state-object + single-renderfunction pattern: one JS array holds all bookings as the source of
truth; every action (changing the status filter, confirming/cancelling a
booking) updates that array first, then calls one render() function
that redraws the entire table from scratch. This avoids the bugs that
come from patching individual DOM elements in multiple places, and
keeps the UI reliably in sync with actual data even without a framework
*/