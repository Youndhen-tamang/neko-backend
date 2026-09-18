import { readFileSync } from "fs";
import { resolve } from "path";
import { uploadImage } from "./src/services/cloudinary";

(async () => {
  try {
    const buffer = readFileSync(resolve(__dirname, "placeholder.jpg"));
    const url = await uploadImage(buffer, "test");
    console.log("Cloudinary upload succeeded");
    console.log(url);
  } catch (error) {
    console.error("Cloudinary upload failed");
    console.error(error);
    process.exitCode = 1;
  }
})();
