import bcrypt from "bcrypt";
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { User } from "../server/models/Staff.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

function promptHidden(question) {
  if (!input.isTTY) {
    throw new Error("This script must be run in an interactive terminal.");
  }

  output.write(question);
  input.setRawMode(true);
  input.resume();
  input.setEncoding("utf8");

  return new Promise((resolve, reject) => {
    let value = "";

    function finish() {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
      output.write("\n");
      resolve(value);
    }

    function onData(character) {
      if (character === "\u0003") {
        input.setRawMode(false);
        input.pause();
        input.removeListener("data", onData);
        reject(new Error("Admin creation cancelled."));
      } else if (character === "\r" || character === "\n") {
        finish();
      } else if (character === "\u007f" || character === "\b") {
        value = value.slice(0, -1);
      } else {
        value += character;
      }
    }

    input.on("data", onData);
  });
}

async function createAdmin() {
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required in the project-root .env file.");
  }

  const prompts = createInterface({ input, output });
  try {
    const userName = (await prompts.question("Admin name: ")).trim();
    const userEmail = (await prompts.question("Admin email: ")).trim().toLowerCase();
    prompts.close();
    const password = await promptHidden("Admin password (hidden): ");

    if (!userName || !/^\S+@\S+\.\S+$/.test(userEmail)) {
      throw new Error("Enter a name and a valid email address.");
    }

    if (password.length < 12) {
      throw new Error("Use a password with at least 12 characters.");
    }

    await mongoose.connect(process.env.MONGODB_URI);

    const existingUser = await User.exists({ userEmail });
    if (existingUser) {
      throw new Error("A staff account with that email already exists.");
    }

    const userPassword = await bcrypt.hash(password, 12);
    const admin = await User.create({ userName, userEmail, userPassword, userRole: "admin" });
    console.log(`Admin account created for ${admin.userEmail}.`);
  } finally {
    prompts.close();
    await mongoose.disconnect();
  }
}

createAdmin().catch((error) => {
  console.error(`Could not create admin: ${error.message}`);
  process.exitCode = 1;
});
