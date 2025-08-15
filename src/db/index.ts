import { MongoClient } from 'mongodb';

const uri = 'your_mongodb_connection_string';
let client: MongoClient;

export const connectToDatabase = async () => {
    if (!client) {
        client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
        await client.connect();
    }
    return client.db('ford_location_dashboard');
};

export const saveVehicleData = async (vehicleData: any) => {
    const db = await connectToDatabase();
    const collection = db.collection('vehicles');
    await collection.insertOne(vehicleData);
};