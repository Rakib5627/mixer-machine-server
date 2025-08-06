const express = require('express');
const cors = require('cors');
const { ObjectId } = require("mongodb");
const { MongoClient, ServerApiVersion } = require('mongodb');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());


// MongoDB URI
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.y5comcm.mongodb.net/?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// **Global Sensor Data Variable (Updated in API)**
let sensorData = {
  temperature: 25,
  humidity: 50,
  acceleration: { x: 0, y: 0, z: 0 },
  current: 0
};

// **Mixer State**
let mixerState = "off";  // Default state

async function run() {
  try {
    // await client.connect();
    // console.log("✅ Successfully connected to MongoDB!");

    const database = client.db("RecipeDB");  // database name
    const userCollection = database.collection("users");
    const sensorCollection = database.collection("sensorData"); // New collection
    const mixerCollection = database.collection("mixerState");
    const presetCollection = database.collection("presets");
    const historyCollection = database.collection("history");

    // initiate mixer state from database 
    const mixerStateDoc = await mixerCollection.findOne({});
    let mixerState = mixerStateDoc ? mixerStateDoc.state : "off";  // Default to "off" if no data


    // **GET all users**
    app.get('/users', async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    // **POST a new user**
    app.post('/users', async (req, res) => {
      const user = req.body;
      const existingUser = await userCollection.findOne({ email: user.email });

      if (existingUser) {
        return res.status(400).json({ error: "User already exists" });
      }

      const result = await userCollection.insertOne(user);
      res.status(201).json(result);
    });

    //machine presets post 

    app.post('/api/machine01/presets', async (req, res) => {
      try {
        const preset = req.body;

        // Validate essential fields
        if (!preset.cropName || !preset.cropVariety || !preset.fertilizers || !preset.mixingTime) {
          return res.status(400).json({ error: "Invalid preset data" });
        }

        // Add a timestamp
        preset.createdAt = new Date();

        const result = await presetCollection.insertOne(preset);
        res.status(201).json({ message: "Preset saved successfully", id: result.insertedId });
      } catch (error) {
        console.error("❌ Error saving preset:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // GET: Fetch presets for a machine
    // Fetch all presets (for machine01)
    app.get('/api/machine01/presets', async (req, res) => {
      try {
        const presets = await presetCollection.find().toArray(); // No filter needed
        res.json(presets);
      } catch (error) {
        console.error(" Error fetching presets:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    app.delete('/api/machine01/presets/:id', async (req, res) => {
      const { id } = req.params;
      try {
        const result = await presetCollection.deleteOne({ _id: new ObjectId(id) });
        res.json({ success: result.deletedCount > 0 });
      } catch (error) {
        console.error("❌ Error deleting preset:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    app.put('/api/machine01/presets/:id', async (req, res) => {
      const { id } = req.params;
      const updatedPreset = req.body;

      try {
        const result = await presetCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedPreset }
        );

        res.json({ success: result.modifiedCount > 0 });
      } catch (error) {
        console.error("Error updating preset:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });



    // Save a history record when a preset is run
app.post('/api/machine01/history', async (req, res) => {
  try {
    const { presetId, cropName, cropVariety, mixingTime } = req.body;

    if (!presetId || !cropName || !mixingTime) {
      return res.status(400).json({ error: "Invalid history data" });
    }

    const historyEntry = {
      presetId,
      cropName,
      cropVariety,
      mixingTime,
      runAt: new Date()
    };

    const result = await historyCollection.insertOne(historyEntry);
    res.status(201).json({ message: "History saved", id: result.insertedId });
  } catch (error) {
    console.error("❌ Error saving history:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get all history records (latest first)
app.get('/api/machine01/history', async (req, res) => {
  try {
    const history = await historyCollection.find().sort({ runAt: -1 }).toArray();
    res.json(history);
  } catch (error) {
    console.error("❌ Error fetching history:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});




    // **Receive Sensor Data from NodeMCU**
    app.post('/api/data', async (req, res) => {
      try {
        const { temperature, humidity, acceleration, current } = req.body;

        if (temperature == null || humidity == null || !acceleration || current == null) {
          return res.status(400).json({ error: "Invalid sensor data" });
        }

        // Update global sensor data
        sensorData = { temperature, humidity, acceleration, current };

        // Store in MongoDB
        const newEntry = {
          temperature,
          humidity,
          acceleration,
          current,
          timestamp: new Date()
        };

        await sensorCollection.insertOne(newEntry);


        console.log("✅ Sensor data updated:", sensorData);
        res.json({ message: "Sensor data stored successfully", data: sensorData });

      } catch (error) {
        console.error("❌ Error storing sensor data:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // **Fetch Latest Sensor Data**
    app.get('/api/data', (req, res) => {
      res.json(sensorData);
    });


    //  GET Mixer State (For Frontend & NodeMCU)
    app.get("/api/mixer/control", async (req, res) => {
      try {
        const mixerStateDoc = await mixerCollection.findOne({});
        res.json({ state: mixerStateDoc ? mixerStateDoc.state : "off" });
      } catch (error) {
        console.error("❌ Error fetching mixer state:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    //  POST Mixer State (From Frontend & NodeMCU)
    app.post("/api/mixer/control", async (req, res) => {
      const { state } = req.body;
      if (state !== "on" && state !== "off") {
        return res.status(400).json({ error: "Invalid state" });
      }

      try {
        // Update mixer state in MongoDB
        await mixerCollection.updateOne({}, { $set: { state } }, { upsert: true });
        mixerState = state;  // Also update global variable
        console.log(`Mixer switched ${state}`);

        res.json({ success: true, state });
      } catch (error) {
        console.error("❌ Error updating mixer state:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

  } catch (error) {
    console.error('❌ Error connecting to MongoDB:', error);
  }
}

// **Start the Server**
run();

// **Default Route**
app.get('/', (req, res) => {
  res.send('✅ Server is running!');
});

app.listen(port, () => {
  console.log(`🚀 Server running on port: ${port}`);
});

