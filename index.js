const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

/* ========================
   MongoDB Connection
======================== */

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: ServerApiVersion.v1,
});

async function connectDB() {
  try {
    await client.connect();
    console.log("✅ MongoDB connected successfully");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
}

connectDB();

/* ========================
   Database Collections
======================== */

const database = client.db("dentistryDB");
const Doctors = database.collection("lalumia");
const Services = database.collection("services");
const Reviews = database.collection("reviews");
const usersCollection = database.collection("users");

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

/* ========= Services ========= */

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

// users post
app.post("/users", async (req, res) => {
  try {
    const { name, email, photoURL } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const existingUser = await usersCollection.findOne({ email });

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

      await usersCollection.insertOne(newUser);

      return res.json({
        success: true,
        message: "User created",
        type: "register",
      });
    } else {
      // 🔁 Existing user (LOGIN)
      await usersCollection.updateOne(
        { email },
        {
          $set: {
            lastLoginAt: new Date(),
            name,
            photoURL,
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

    const user = await usersCollection.findOne({ email });

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

app.post("/services", async (req, res) => {
  const result = await Services.insertOne(req.body);
  res.send(result);
});

/* ========= Doctors (Lalumia) ========= */

app.get("/lalumia", async (req, res) => {
  const doctors = await Doctors.find({}).toArray();
  res.send(doctors);
});

app.post("/lalumia", async (req, res) => {
  const doctor = {
    ...req.body,
    permission: "pending",
    createdAt: new Date(),
  };

  const result = await Doctors.insertOne(doctor);
  res.send(result);
});

app.patch("/lalumia/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { permission } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).send({ error: "Invalid ID" });
    }

    if (!["approved", "rejected"].includes(permission)) {
      return res.status(400).send({ error: "Invalid permission value" });
    }

    const result = await Doctors.updateOne(
      { _id: new ObjectId(id) },
      { $set: { permission } },
    );

    res.send(result);
  } catch (error) {
    console.error("Update Error:", error);
    res.status(500).send({ error: "Server Error" });
  }
});

/* ========= Reviews ========= */

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
