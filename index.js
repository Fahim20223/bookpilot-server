const express = require("express");
const cors = require("cors");
const app = express();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const admin = require("firebase-admin");

const serviceAccount = require("./book-pilot-adminsdk.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//booksCollection
// MuoQ3MxMJKxDg0ks

//middleware
app.use(
  cors({
    origin: [process.env.CLIENT_DOMAIN],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@flash0.nw85ito.mongodb.net/?appName=Flash0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection

    const db = client.db("booksDB");
    const booksCollection = db.collection("books");
    const ordersCollection = db.collection("orders");

    //save a book data

    app.post("/books", async (req, res) => {
      const bookData = req.body;
      console.log("Book data being saved:", bookData);
      const result = await booksCollection.insertOne(bookData);
      res.send(result);
    });

    //get all books
    app.get("/books", async (req, res) => {
      const result = await booksCollection.find().toArray();
      res.send(result);
    });

    app.get("/books/:id", async (req, res) => {
      const id = req.params.id;
      const result = await booksCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    //payment endpoint
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;
      console.log(paymentInfo);

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo?.name,
                description: paymentInfo?.description,
                images: [paymentInfo?.image],
              },
              unit_amount: paymentInfo?.price * 100,
            },
            quantity: paymentInfo?.quantity,
          },
        ],
        customer_email: paymentInfo?.customer?.email,
        mode: "payment",
        metadata: {
          bookId: paymentInfo?.bookId,
          customer: paymentInfo?.customer.email,
        },
        success_url: `${process.env.CLIENT_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/books/${paymentInfo?.bookId}`,
      });
      res.send({ url: session.url });
    });

    app.post("/payment-success", async (req, res) => {
      const { sessionId } = req.body;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log(session);

      const book = await booksCollection.findOne({
        _id: new ObjectId(session.metadata.bookId),
      });

      const order = await ordersCollection.findOne({
        transactionId: session.payment_intent,
      });

      if (session.status === "complete" && book && !order) {
        //save order data in db
        const orderInfo = {
          bookId: session.metadata.bookId,
          transactionId: session.payment_intent,
          customer: session.metadata.customer,
          status: "pending",
          seller: book.seller,
          name: book.name,
          // status: book.status,
          quantity: 1,
          price: session.amount_total / 100,
          image: book?.image,
        };
        const result = await ordersCollection.insertOne(orderInfo);
        //update book quantity
        await booksCollection.updateOne(
          {
            _id: new ObjectId(session.metadata.bookId),
          },
          { $inc: { quantity: -1 } }
        );

        return res.send({
          transactionId: session.payment_intent,
          orderId: result.insertedId,
        });
      }
      res.send(
        res.send({
          transactionId: session.payment_intent,
          orderId: order._id,
        })
      );
    });

    //get all orders for a customer by email
    app.get("/my-orders/:email", async (req, res) => {
      const email = req.params.email;
      const result = await ordersCollection
        .find({
          customer: email,
        })
        .toArray();
      res.send(result);
    });

    //manage orders
    //get all orders for a seller by email
    app.get("/manage-orders/:email", async (req, res) => {
      const email = req.params.email;
      const result = await ordersCollection
        .find({
          "seller.email": email,
        })
        .toArray();
      res.send(result);
    });

    //inventory
    app.get("/my-inventory/:email", async (req, res) => {
      const email = req.params.email;
      const result = await booksCollection
        .find({
          "seller.email": email,
        })
        .toArray();
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
