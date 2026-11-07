import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { cloudinaryConfig, cloudinarySignature, signedUpload } from "@/lib/cloudinary";
import { imageUrl } from "@/lib/images";

describe("Cloudinary", () => {
  it("signs exactly like Cloudinary's documented example", () => {
    // https://cloudinary.com/documentation/authentication_signatures
    expect(
      cloudinarySignature(
        { timestamp: 1315060510, public_id: "sample_image", eager: "w_400,h_300,c_pad|w_260,h_200,c_crop" },
        "abcd",
      ),
    ).toBe("bfd09f95f331f558cbd1320e67aa8d488770583e");
  });

  it("builds a one-photo signed upload restricted to our folder and image formats", () => {
    const t = signedUpload({ cloudName: "ife", apiKey: "123", apiSecret: "s3cret" }, "abc", 1_700_000_000_000);
    expect(t.uploadUrl).toBe("https://api.cloudinary.com/v1_1/ife/image/upload");
    expect(t.fields).toMatchObject({ folder: "ifecollection/products", public_id: "abc", timestamp: 1_700_000_000, api_key: "123", allowed_formats: "jpg,png,webp" });
    const expected = createHash("sha1")
      .update("allowed_formats=jpg,png,webp&folder=ifecollection/products&public_id=abc&timestamp=1700000000s3cret")
      .digest("hex");
    expect(t.fields.signature).toBe(expected);
    expect(JSON.stringify(t)).not.toContain("s3cret"); // the secret never goes to the phone
  });

  it("reads config from separate variables or CLOUDINARY_URL, and is off when missing", () => {
    expect(cloudinaryConfig({})).toBeNull();
    expect(cloudinaryConfig({ CLOUDINARY_CLOUD_NAME: "ife", CLOUDINARY_API_KEY: "k" })).toBeNull();
    expect(cloudinaryConfig({ CLOUDINARY_URL: "cloudinary://key:secret@ife" })).toEqual({ apiKey: "key", apiSecret: "secret", cloudName: "ife" });
    expect(cloudinaryConfig({ CLOUDINARY_CLOUD_NAME: "ife", CLOUDINARY_API_KEY: "k", CLOUDINARY_API_SECRET: "s" })).toEqual({
      cloudName: "ife", apiKey: "k", apiSecret: "s",
    });
  });

  it("makes small thumbnails and phone-friendly formats from the URL", () => {
    const img = { provider: "cloudinary", path: "https://res.cloudinary.com/ife/image/upload/v17/ifecollection/products/abc.webp" };
    expect(imageUrl(img, "thumb")).toBe(
      "https://res.cloudinary.com/ife/image/upload/c_fill,g_auto,w_320,h_320,f_auto,q_auto/v17/ifecollection/products/abc.webp",
    );
    expect(imageUrl(img, "full")).toContain("/image/upload/c_limit,w_1200,h_1200,f_auto,q_auto/v17/");
    // Old Supabase photos keep working.
    expect(imageUrl({ provider: "supabase", path: "p/a.webp", thumb_path: "p/a-t.webp" }, "thumb")).toContain(
      "/storage/v1/object/public/product-images/p/a-t.webp",
    );
  });
});
