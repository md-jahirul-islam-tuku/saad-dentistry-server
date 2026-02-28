/**
 * =========================================================
 * SaaD Dentistry Backend Server
 * =========================================================
 * Author: Md Jahirul Islam Tuku
 * Description: Dental Appointment & Payment System API
 * Tech Stack: Node.js, Express, MongoDB, JWT, Stripe
 * =========================================================
 */

const express = require("express");
const Stripe = require("stripe");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

/* ========================
   App Initialization
======================== */

const app = express();
const port = process.env.PORT || 5000;

/* ========================
   Global Middlewares
======================== */

app.use(cors());
app.use(express.json());

/* ========================
   Stripe Configuration
======================== */

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/* ========================
   MongoDB Configuration
======================== */

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: ServerApiVersion.v1,
});

/* ========================
   Database & Collections
======================== */

let db;
let Doctors, Services, Reviews, Users, Appointments, Payments;

/* ========================
   Connect to MongoDB
======================== */

async function connectDatabase() {
  try {
    await client.connect();
    db = client.db("dentistryDB");

    Doctors = db.collection("doctors-all");
    Services = db.collection("services");
    Reviews = db.collection("reviews");
    Users = db.collection("users");
    Appointments = db.collection("appointments");
    Payments = db.collection("payments");

    console.log("✅ MongoDB Connected Successfully");
  } catch (error) {
    console.error("❌ MongoDB Connection Failed:", error);
    process.exit(1);
  }
}

connectDatabase();

/* ========================
   JWT Middleware
======================== */

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized access" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Forbidden access" });
    }
    req.decoded = decoded;
    next();
  });
}

/* ========================
   Routes
======================== */

// Root
app.get("/", (req, res) => {
  res.send("SaaD Dentistry server is running...");
});

// JWT
app.post("/jwt", (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: "40d",
  });
  res.send({ token });
});

/* ========================
   Services
======================== */

app.get("/services", async (req, res) => {
  const services = await Services.find({}).toArray();
  res.send(services);
});

app.get("/services/:id", async (req, res) => {
  const id = req.params.id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ error: "Invalid ID" });
  }

  const service = await Services.findOne({ _id: new ObjectId(id) });
  res.send(service);
});

app.post("/services", async (req, res) => {
  const result = await Services.insertOne(req.body);
  res.send(result);
});


app.put("/services/:id", async (req, res) => {
  const id = req.params.id;
  const updatedData = req.body;

  const filter = { _id: new ObjectId(id) };

  const updateDoc = {
    $set: {
      title: updatedData.title,
      img: updatedData.img,
      rating: updatedData.rating,
      price: updatedData.price,
      description: updatedData.description,
    },
  };

  const result = await Services.updateOne(filter, updateDoc);

  res.send(result);
});

/* ========================
   Users appointments
======================== */

app.post("/appointment", async (req, res) => {
  try {
    const data = req.body;
    const { doctorName, doctorEmail } = data;
    if (!doctorName && !doctorEmail) {
      return res.status(400).json({ message: "Doctor name is required" });
    }
    const result = await Appointments.insertOne({
      ...data,
      paymentStatus: "unpaid",
    });
    res.send(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/appointments", async (req, res) => {
  try {
    const { role, email } = req.query;

    let query = {};

    if (role === "user") {
      query = { email: email };
    }

    if (role === "doctor") {
      query = { doctorEmail: email };
    }
    const result = await Appointments.find(query).toArray();

    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch appointments",
      error: error.message,
    });
  }
});

app.delete("/appointment/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await Appointments.deleteOne({ _id: new ObjectId(id) });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Appointment not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Appointment deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

app.get("/appointment/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: "Invalid ID" });
    }

    const appointment = await Appointments.findOne({ _id: new ObjectId(id) });
    res.send(appointment);
  } catch (error) {
    res.status(500).json({
      message: "Failed to fetch appointments",
      error: error.message,
    });
  }
});

/* ========================
   Pay to stripe
======================== */

app.post("/create-payment-intent", async (req, res) => {
  try {
    const { serviceId, customerName, customerEmail } = req.body;

    if (!serviceId) {
      return res.status(400).json({ message: "Service ID is required" });
    }

    // 🔐 Always calculate price from DB (Never trust frontend)
    const service = await Services.findOne({
      _id: new ObjectId(serviceId),
    });

    if (!service) {
      return res.status(404).json({ message: "Service not found" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: service.price * 100, // convert to cents
      currency: "usd",
      automatic_payment_methods: {
        enabled: true,
      },
      metadata: {
        serviceId: service._id.toString(),
        serviceTitle: service.title,
        customerName,
        customerEmail,
      },
    });

    res.send({
      clientSecret: paymentIntent.client_secret,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* ====================================
   Save Payment & Update Appointment
==================================== */

app.post("/payments", async (req, res) => {
  try {
    const { appointmentId, paymentIntentId, customerEmail, customerName } =
      req.body;

    // 🔎 Validate appointmentId
    if (!ObjectId.isValid(appointmentId)) {
      return res.status(400).json({ message: "Invalid appointment ID" });
    }

    // 🔍 Find appointment
    const appointment = await Appointments.findOne({
      _id: new ObjectId(appointmentId),
    });

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    // ❌ Prevent duplicate payment
    if (appointment.paymentStatus === "paid") {
      return res.status(400).json({ message: "Appointment already paid" });
    }

    // 🔐 Always get price from DB (never trust frontend)
    const service = await Services.findOne({
      _id: new ObjectId(appointment.serviceId),
    });

    if (!service) {
      return res.status(404).json({ message: "Service not found" });
    }

    const amount = service.price;

    // 1️⃣ Save payment history
    const paymentDoc = {
      appointmentId: new ObjectId(appointmentId),
      serviceId: service._id,
      serviceTitle: service.title,
      amount,
      currency: "usd",
      paymentIntentId,
      transactionId: paymentIntentId,
      customerName,
      customerEmail,
      status: "succeeded",
      createdAt: new Date(),
    };

    await Payments.insertOne(paymentDoc);

    // 2️⃣ Update appointment status
    await Appointments.updateOne(
      { _id: new ObjectId(appointmentId) },
      {
        $set: {
          paymentStatus: "paid",
          transactionId: paymentIntentId,
          paidAt: new Date(),
        },
      },
    );

    res.status(201).json({
      success: true,
      message: "Payment stored successfully",
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

/* ========================
   Users
======================== */

app.post("/users", async (req, res) => {
  try {
    const { name, email, photoURL } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const existingUser = await Users.findOne({ email });

    if (!existingUser) {
      // 🆕 New user (REGISTER)
      const newUser = {
        name,
        email,
        photoURL,
        role: "user",
        createdAt: new Date(),
        lastLoginAt: new Date(),
      };

      await Users.insertOne(newUser);

      return res.json({
        success: true,
        message: "User created",
        type: "register",
      });
    } else {
      // 🔁 Existing user (LOGIN)
      await Users.updateOne(
        { email },
        {
          $set: {
            lastLoginAt: new Date(),
          },
        },
      );

      return res.json({
        success: true,
        message: "Login time updated",
        type: "login",
      });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/users/:email", async (req, res) => {
  try {
    const { email } = req.params;

    const user = await Users.findOne({ email });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      success: true,
      data: user,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/users", async (req, res) => {
  try {
    const users = await Users.find({}).toArray();

    if (!users) {
      return res.status(404).json({ message: "There have no users" });
    }

    res.json({
      success: true,
      data: users,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.get("/users/check/:email", async (req, res) => {
  try {
    const email = req.params.email;

    const existingUser = await Users.findOne({ email });

    if (existingUser) {
      return res.status(409).json({
        message: "Email already registered. Please login.",
      });
    }

    res.status(200).json({ message: "Email available" });
  } catch (error) {
    res.status(500).json({
      message: "Server error",
      error: error.message,
    });
  }
});

app.patch("/user/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { role } = req.body;
    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: "Invalid ID" });
    }
    const user = await Users.findOne({ _id: new ObjectId(id) });
    if (user.role === "admin" && role !== "admin") {
      const adminCount = await Users.countDocuments({
        role: "admin",
      });
      if (adminCount <= 1) {
        return res.status(400).send({
          error: "At least one admin must remain in the system",
        });
      }
    }
    const userUpdate = await Users.updateOne(
      { _id: new ObjectId(id) },
      {
        $set: { role },
      },
    );
    res.send({
      modifiedCount: userUpdate.modifiedCount,
      message: "Role updated successfully",
    });
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).send({ error: "Server Error" });
  }
});

app.delete("/user/:id", verifyJWT, async (req, res) => {
  const id = req.params.id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ error: "Invalid ID" });
  }

  const result = await Users.deleteOne({
    _id: new ObjectId(id),
  });

  res.send(result);
});

/* ========================
   Doctors (doctors-all)
======================== */

app.get("/doctors-all", async (req, res) => {
  const doctors = await Doctors.find({}).toArray();
  res.send(doctors);
});

app.post("/doctors-all", async (req, res) => {
  const doctor = {
    ...req.body,
    permission: "pending",
    createdAt: new Date(),
  };

  const result = await Doctors.insertOne(doctor);
  res.send(result);
});

app.patch("/doctors-all/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { permission } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: "Invalid ID" });
    }

    if (!["approved", "rejected"].includes(permission)) {
      return res.status(400).send({ error: "Invalid permission value" });
    }

    // 1️⃣ Find doctor first
    const doctor = await Doctors.findOne({
      _id: new ObjectId(id),
    });

    if (!doctor) {
      return res.status(404).send({ error: "Doctor not found" });
    }

    // 2️⃣ Update doctor permission
    const doctorUpdate = await Doctors.updateOne(
      { _id: new ObjectId(id) },
      { $set: { permission } },
    );

    // 3️⃣ Update user role based on permission
    const newRole = permission === "approved" ? "doctor" : "user";

    const userUpdate = await Users.updateOne(
      { email: doctor.email },
      { $set: { role: newRole, roleUpdateAt: new Date() } },
    );

    res.send({
      doctorUpdate,
      userUpdate,
      message: "Permission & role updated successfully",
    });
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).send({ error: "Server Error" });
  }
});

/* ========================
   Reviews
======================== */

app.get("/reviews", verifyJWT, async (req, res) => {
  const decoded = req.decoded;

  if (decoded.email !== req.query.email) {
    return res.status(403).send({ message: "Unauthorized access" });
  }

  const query = req.query.email ? { email: req.query.email } : {};

  const reviews = await Reviews.find(query).toArray();
  res.send(reviews);
});

app.get("/review", async (req, res) => {
  const query = req.query.service ? { service: req.query.service } : {};

  const reviews = await Reviews.find(query).toArray();
  res.send(reviews);
});

app.get("/reviews/:id", async (req, res) => {
  const id = req.params.id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ error: "Invalid ID" });
  }

  const review = await Reviews.findOne({ _id: new ObjectId(id) });
  res.send(review);
});

app.post("/reviews", async (req, res) => {
  const result = await Reviews.insertOne(req.body);
  res.send(result);
});

app.put("/reviews/:id", verifyJWT, async (req, res) => {
  const id = req.params.id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ error: "Invalid ID" });
  }

  const updatedDoc = {
    $set: {
      rating: req.body.ratingSub,
      text: req.body.textSub,
    },
  };

  const result = await Reviews.updateOne({ _id: new ObjectId(id) }, updatedDoc);

  res.send(result);
});

app.delete("/reviews/:id", verifyJWT, async (req, res) => {
  const id = req.params.id;

  if (!ObjectId.isValid(id)) {
    return res.status(400).send({ error: "Invalid ID" });
  }

  const result = await Reviews.deleteOne({
    _id: new ObjectId(id),
  });

  res.send(result);
});

/* ========================
   Graceful Shutdown
======================== */

process.on("SIGINT", async () => {
  await client.close();
  console.log("MongoDB connection closed");
  process.exit(0);
});

/* ========================
   Start Server
======================== */

app.listen(port, () => {
  console.log(`🚀 SaaD Dentistry listening on port ${port}`);
});
