/*
Schema for menu items: name, description, price,
category, Cloudinary photo URL, availability flag
*/
import mongoose from "mongoose";
const MenuItems = mongoose.model("Items", new mongoose.Schema({
    itemName: {}, // name of the menu item
    itemDescription: {}, // description of the menu item
    itemPrice: {}, // price of the menu item in peso PHP
    itemCategory: {}, // category of the menu item (e.g. appetizer, main course, dessert, beverage)
    itemPhotoUrl: {}, // Cloudinary URL of the menu item photo
    itemAvailable: {}, // availability flag (true if available, false if not)
    itemNumber: {} // unique item number for reference
})
); export { Items };