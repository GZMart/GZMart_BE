import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverName: {
      type: String,
      required: [true, "Receiver name is required"],
      trim: true,
    },
    phone: {
      type: String,
      required: [true, "Phone number is required"],
      trim: true,
      validate: {
        validator: function (v) {
          return /^[0-9]{10,11}$/.test(v);
        },
        message: "Please enter a valid phone number",
      },
    },
    provinceCode: {
      type: String,
      trim: true,
    },
    provinceName: {
      type: String,
      trim: true,
    },
    districtCode: {
      type: String,
      trim: true,
    },
    districtName: {
      type: String,
      trim: true,
    },
    wardCode: {
      type: String,
      trim: true,
    },
    wardName: {
      type: String,
      trim: true,
    },
    street: {
      type: String,
      trim: true,
    },
    details: {
      type: String,
      trim: true, // specific address details
    },
    location: {
      lat: {
        type: Number,
        min: -90,
        max: 90,
      },
      lng: {
        type: Number,
        min: -180,
        max: 180,
      },
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
addressSchema.index({ userId: 1 });
addressSchema.index({ userId: 1, isDefault: 1 });

const Address = mongoose.model("Address", addressSchema);

export default Address;
