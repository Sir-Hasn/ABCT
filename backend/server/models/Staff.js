/*
Schema for staff accounts: username, bcrypt-hashed
password, role
*/
import mongoose from "mongoose";
const users = mongoose.model("User", new mongoose.Schema({
    userName: {},
    userEmail: {},
    userPassword: {},
    userRole: {}
})
); export { User };