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
    origin: [process.env.CLIENT_DOMAIN, "http://localhost:5173"],
    credentials: true,
    optionsSuccessStatus: 200,
  })
);

app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  // console.log(req.headers);
  const token = req?.headers?.authorization?.split(" ")[1];
  // console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

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
    const usersCollection = db.collection("users");
    const sellerRequestCollection = db.collection("sellerRequests");
    const wishlistsCollection = db.collection("wishlists");
    // const reviewsCollection = db.collection("reviews");

    //role middlewares
    const verifyADMIN = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "admin")
        return res
          .status(403)
          .send({ message: "Admin only Actions!", role: user?.role });

      next();
    };

    const verifyLIBRARIAN = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "librarian")
        return res
          .status(403)
          .send({ message: "Library only Actions!", role: user?.role });

      next();
    };

    //save a book data in db

    app.post("/books", verifyJWT, verifyLIBRARIAN, async (req, res) => {
      const bookData = req.body;
      console.log("Book data being saved:", bookData);
      const result = await booksCollection.insertOne(bookData);

      res.send(result);
    });

    //get all books
    // app.get("/books", async (req, res) => {
    //   const result = await booksCollection
    //     .find({ status: "published" })
    //     .toArray();
    //   res.send(result);
    // });

    //get all the books by search & sort
    // GET: all books with search, sort & pagination

    app.get("/books", async (req, res) => {
      try {
        const {
          search = "",
          sort = "price",
          order = "asc",
          limit = 0,
          skip = 0,
        } = req.query;

        let query = { status: "published" };

        if (search) {
          // Case-insensitive & remove spaces for comparison
          query.$expr = {
            $regexMatch: {
              input: {
                $replaceAll: { input: "$name", find: " ", replacement: "" },
              },
              regex: search.replace(/\s+/g, ""),
              options: "i",
            },
          };
        }

        const sortOption = {};
        sortOption[sort] = order === "desc" ? -1 : 1;

        const books = await booksCollection
          .find(query)
          .sort(sortOption)
          .limit(Number(limit))
          .skip(Number(skip))
          .toArray();

        //
        res.send(books);
      } catch (error) {
        console.log(error);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    //details-page
    app.get("/books/:id", async (req, res) => {
      const id = req.params.id;
      const result = await booksCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    //latest-books
    app.get("/latest-books", async (req, res) => {
      const result = await booksCollection
        .find({ status: "published" })
        .sort({ createdAt: "desc" })
        .limit(4)
        .toArray();
      res.send(result);
    });

    //books-update
    app.put("/books/:id", async (req, res) => {
      const id = req.params.id;
      const data = req.body;
      const query = { _id: new ObjectId(id) };
      const update = {
        $set: data,
      };
      const result = await booksCollection.updateOne(query, update);
      res.send(result);
    });

    //delete orders for librarian
    app.delete(
      "/manage-orders/:id",
      verifyJWT,
      verifyLIBRARIAN,
      async (req, res) => {
        const id = req.params.id;

        const query = { _id: new ObjectId(id) };
        const result = await ordersCollection.deleteOne(query);
        res.send(result);
      }
    );

    //push books-wishlist
    // app.post("/wishlists/:id", verifyJWT, async (req, res) => {
    //   const data = req.body;

    //   const result = await wishlistsCollection.insertOne(data);
    //   res.send(result);
    // });
    app.post("/wishlists/:id", verifyJWT, async (req, res) => {
      const wishlistItem = {
        ...req.body,
        userEmail: req.tokenEmail, // 🔐 FORCE ownership
        createdAt: new Date(),
      };

      const result = await wishlistsCollection.insertOne(wishlistItem);
      res.send(result);
    });

    //get-wishlists
    app.get("/my-wishlists", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;

      const result = await wishlistsCollection
        .find({ userEmail: email })
        .toArray();

      res.send(result);
    });

    //customer wishlists delete from dashboard
    app.delete("/wishlists/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;

      const query = { _id: new ObjectId(id) };
      const result = await wishlistsCollection.deleteOne(query);
      res.send(result);
    });

    //admin to status changed
    app.patch("/books-status/:id", verifyJWT, verifyADMIN, async (req, res) => {
      const id = req.params.id;
      const data = req.body;
      const query = { _id: new ObjectId(id) };
      const update = {
        $set: data,
      };
      const result = await booksCollection.updateOne(query, update);
      res.send(result);
    });

    //manage-books to get all books
    app.get("/manage-books", verifyJWT, verifyADMIN, async (req, res) => {
      const result = await booksCollection.find().toArray();
      res.send(result);
    });

    //manage-books to delete
    app.delete(
      "/manage-books/:id",
      verifyJWT,
      verifyADMIN,
      async (req, res) => {
        const id = req.params.id;

        const query = { _id: new ObjectId(id) };
        const result = await booksCollection.deleteOne(query);
        res.send(result);
      }
    );

    //invoices for user
    app.get("/my-invoices", verifyJWT, async (req, res) => {
      const invoices = await ordersCollection
        .find({
          customer: req.tokenEmail,
          paymentStatus: "paid",
        })
        .sort({ paidAt: -1 })
        .project({
          transactionId: 1,
          price: 1,
          name: 1,
          paidAt: 1,
        })
        .toArray();
      res.send(invoices);
    });

    // total orders admin statistics
    app.get("/admin-statistics", verifyJWT, verifyADMIN, async (req, res) => {
      try {
        const orders = await ordersCollection
          .find({ paymentStatus: "paid" })
          .toArray();
        let totalRevenue = 0;
        orders.forEach((order) => {
          totalRevenue += order.price;
        });
        const totalOrders = await ordersCollection.countDocuments();
        const totalBooks = await booksCollection.countDocuments();
        const totalUsers = await usersCollection.countDocuments();

        res.send({
          revenue: totalRevenue,
          orders: totalOrders,
          books: totalBooks,
          users: totalUsers,
        });
      } catch (error) {
        console.log(error);
      }
    });

    //customer statistics
    // CUSTOMER STATISTICS
    app.get("/customer-statistics", verifyJWT, async (req, res) => {
      try {
        const email = req.tokenEmail;

        // Get all paid orders for this user
        const orders = await ordersCollection
          .find({ customer: email, paymentStatus: "paid" })
          .toArray();

        // If no orders, totalExpenses and totalBooks will be 0
        const totalExpenses = orders.length
          ? orders.reduce((sum, order) => sum + order.price, 0)
          : 0;

        const totalBooks = orders.length
          ? orders.reduce((sum, order) => sum + order.quantity, 0)
          : 0;

        // Send data matching frontend keys
        res.send({
          expenses: totalExpenses,
          books: totalBooks,
        });
      } catch (error) {
        console.error(error);
      }
    });

    //librarian section statistics
    // Librarian statistics
    app.get(
      "/librarian-statistics",
      verifyJWT,
      verifyLIBRARIAN,
      async (req, res) => {
        try {
          const librarianEmail = req.tokenEmail;

          // Seller books
          const books = await booksCollection
            .find({ "seller.email": librarianEmail })
            .toArray();

          // Paid orders of this seller
          const orders = await ordersCollection
            .find({
              "seller.email": librarianEmail,
              paymentStatus: "paid",
            })
            .toArray();

          // Total revenue
          const totalRevenue = orders.reduce(
            (sum, order) => sum + order.price,
            0
          );

          // Total orders
          const totalOrders = orders.length;

          // Unique customers
          const totalCustomers = new Set(orders.map((order) => order.customer));

          res.send({
            revenue: totalRevenue,
            orders: totalOrders,
            books: books.length,
            customers: totalCustomers.size,
          });
        } catch (error) {
          console.log("Librarian stats error:", error);
        }
      }
    );

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
          orderId: paymentInfo.bookId, // Pass order ID
          bookId: paymentInfo?.bookId,
          customer: paymentInfo?.customer.email,
        },
        success_url: `${process.env.CLIENT_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.CLIENT_DOMAIN}/payment-cancelled?session_id={CHECKOUT_SESSION_ID}`,
      });
      res.send({ url: session.url });
    });

    // cancel_url: `${process.env.CLIENT_DOMAIN}/books/${paymentInfo?.bookId}
    // app.post("/payment-success", async (req, res) => {
    //   const { sessionId } = req.body;
    //   const session = await stripe.checkout.sessions.retrieve(sessionId);
    //   // console.log(session);

    //   const book = await booksCollection.findOne({
    //     _id: new ObjectId(session.metadata.bookId),
    //   });

    //   const order = await ordersCollection.findOne({
    //     transactionId: session.payment_intent,
    //   });

    //   if (session.status === "complete" && book && !order) {
    //     //save order data in db
    //     const orderInfo = {
    //       bookId: session.metadata.bookId,
    //       transactionId: session.payment_intent,
    //       customer: session.metadata.customer,
    //       status: "pending",
    //       seller: book.seller,
    //       name: book.name,
    //       // status: book.status,
    //       quantity: 1,
    //       price: session.amount_total / 100,
    //       image: book?.image,
    //     };
    //     const result = await ordersCollection.insertOne(orderInfo);
    //     //update book quantity
    //     await booksCollection.updateOne(
    //       {
    //         _id: new ObjectId(session.metadata.bookId),
    //       },
    //       { $inc: { quantity: -1 } }
    //     );

    //     return res.send({
    //       transactionId: session.payment_intent,
    //       orderId: result.insertedId,
    //     });
    //   }
    //   res.send(
    //     res.send({
    //       transactionId: session.payment_intent,
    //       orderId: order._id,
    //     })
    //   );
    // });

    // PATCH: Verify payment & update order when confirmed
    // app.patch("/payment-success", async (req, res) => {
    //   try {
    //     const { sessionID } = req.body;
    //     const session = await stripe.checkout.sessions.retrieve(sessionID);

    //     // Find the order by transactionId
    //     const order = await ordersCollection.findOne({
    //       transactionId: session.payment_intent,
    //     });

    //     if (!order) {
    //       return res
    //         .status(404)
    //         .send({ success: false, message: "Order not found" });
    //     }

    //     // Update order only if not already completed
    //     if (order.status !== "completed") {
    //       await ordersCollection.updateOne(
    //         { _id: order._id },
    //         {
    //           $set: {
    //             paymentStatus: "paid",
    //             status: "completed",
    //             paidAt: new Date(),
    //           },
    //         }
    //       );

    //       // Update book quantity
    //       await booksCollection.updateOne(
    //         { _id: new ObjectId(order.bookId) },
    //         { $inc: { quantity: -1 } }
    //       );
    //     }

    //     res.send({
    //       success: true,
    //       message: "Payment verified & order updated",
    //       transactionId: session.payment_intent,
    //     });
    //   } catch (error) {
    //     console.log("Payment patch error:", error);
    //     res
    //       .status(500)
    //       .send({ success: false, message: "Payment update failed" });
    //   }
    // });

    // PATCH: Verify payment & update order when confirmed
    // app.post("/payment-success", async (req, res) => {
    //   try {
    //     const { sessionId } = req.body; // frontend sends Stripe sessionId
    //     if (!sessionId)
    //       return res.status(400).send({ message: "sessionId required" });

    //     // Retrieve the session from Stripe
    //     const session = await stripe.checkout.sessions.retrieve(sessionId);

    //     if (!session)
    //       return res.status(404).send({ message: "Stripe session not found" });

    //     // Find the order by transactionId
    //     const order = await ordersCollection.findOne({
    //       transactionId: session.payment_intent,
    //     });

    //     if (!order) {
    //       return res
    //         .status(404)
    //         .send({ success: false, message: "Order not found" });
    //     }

    //     // Only update if not already paid
    //     if (order.paymentStatus !== "paid") {
    //       await ordersCollection.updateOne(
    //         { _id: order._id },
    //         {
    //           $set: {
    //             paymentStatus: "paid",
    //             status: "completed",
    //             paidAt: new Date(),
    //           },
    //         }
    //       );

    //       // Decrease book quantity
    //       await booksCollection.updateOne(
    //         { _id: new ObjectId(order.bookId) },
    //         { $inc: { quantity: -1 } }
    //       );
    //     }

    //     res.send({
    //       success: true,
    //       message: "Payment verified & order updated",
    //       orderId: order._id,
    //       transactionId: session.payment_intent,
    //     });
    //   } catch (error) {
    //     console.log("Payment success error:", error);
    //     res
    //       .status(500)
    //       .send({ success: false, message: "Payment verification failed" });
    //   }
    // });

    // POST: Verify payment & update order when confirmed
    app.post("/payment-success", verifyJWT, async (req, res) => {
      try {
        const { sessionId } = req.body;
        // console.log(req.body);
        if (!sessionId)
          return res.status(400).send({ message: "sessionId required" });

        // Retrieve the session from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        console.log(session);
        if (!session)
          return res.status(404).send({ message: "Stripe session not found" });

        // Find the order by transactionId and customer email
        console.log(session.metadata.bookId);
        const order = await ordersCollection.findOne({
          // transactionId: session.payment_intent,

          bookId: session.metadata.bookId,
          // customer: req.tokenEmail,
          //
          // ensures only customer can mark their own order
        });
        console.log(order);

        if (!order) {
          return res
            .status(404)
            .send({ success: false, message: "Order not found" });
        }

        // Only update if not already paid
        if (order.paymentStatus !== "paid") {
          const result = await ordersCollection.updateOne(
            { _id: order._id, customer: req.tokenEmail },
            {
              $set: {
                status: "paid",
                transactionId: session.payment_intent,
                paymentStatus: "paid",
                paidAt: new Date(),
              },
            }
          );

          // Update book quantity if order updated successfully
          if (result.modifiedCount > 0) {
            await booksCollection.updateOne(
              { _id: new ObjectId(order.bookId) },
              { $inc: { quantity: -1 } }
            );

            return res.send({
              success: true,
              message: "Payment verified & order updated",
              orderId: order._id,
              transactionId: session.payment_intent,
            });
          } else {
            return res.status(400).send({
              success: false,
              message: "Order already paid or cannot update",
            });
          }
        } else {
          return res.send({
            success: true,
            message: "Order already marked as paid",
            orderId: order._id,
            transactionId: session.payment_intent,
          });
        }
      } catch (error) {
        console.log("Payment success error:", error);
        res
          .status(500)
          .send({ success: false, message: "Payment verification failed" });
      }
    });

    app.get("/my-orders", verifyJWT, async (req, res) => {
      // const email = req.params.email;

      const result = await ordersCollection
        .find({
          customer: req.tokenEmail,
        })
        .toArray();
      res.send(result);
    });

    //manage orders
    //get all orders for a seller by email
    app.get(
      "/manage-orders/:email",
      verifyJWT,
      verifyLIBRARIAN,
      async (req, res) => {
        const email = req.params.email;
        const result = await ordersCollection
          .find({
            "seller.email": email,
          })
          .toArray();
        res.send(result);
      }
    );

    //inventory
    app.get(
      "/my-inventory/:email",
      verifyJWT,
      verifyLIBRARIAN,
      async (req, res) => {
        const email = req.params.email;
        const result = await booksCollection
          .find({
            "seller.email": email,
          })
          .toArray();
        res.send(result);
      }
    );

    //save or update a user in db
    app.post("/user", async (req, res) => {
      const userData = req.body;

      userData.created_at = new Date().toISOString();
      userData.last_loggedIn = new Date().toISOString();
      userData.role = "customer";

      const query = {
        email: userData.email,
      };

      const alreadyExist = await usersCollection.findOne(query);
      console.log("User Already Exist----->", !!alreadyExist);
      if (alreadyExist) {
        console.log("Updating user Info......");
        const result = await usersCollection.updateOne(query, {
          $set: {
            last_loggedIn: new Date().toISOString(),
          },
        });
        return res.send(result);
      }

      console.log("Saving new user info");
      const result = await usersCollection.insertOne(userData);
      res.send(result);
    });

    //get a user's role
    app.get("/user/role", verifyJWT, async (req, res) => {
      console.log(req.tokenEmail);
      // const email = req.params.email;
      const result = await usersCollection.findOne({ email: req.tokenEmail });
      res.send({ role: result?.role });
    });

    //save become-seller request
    app.post("/become-seller", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const alreadyExist = await sellerRequestCollection.findOne({ email });
      if (alreadyExist) {
        return res
          .status(409)
          .send({ message: "Already requested , please wait" });
      }
      const result = await sellerRequestCollection.insertOne({ email });
      res.send(result);
    });

    //get all requests for admin
    app.get("/seller-requests", verifyJWT, verifyADMIN, async (req, res) => {
      const result = await sellerRequestCollection.find().toArray();
      res.send(result);
    });

    //get all users for admin
    app.get("/users", verifyJWT, verifyADMIN, async (req, res) => {
      const adminEmail = req.tokenEmail;
      const result = await usersCollection
        .find({ email: { $ne: adminEmail } })
        .toArray();
      res.send(result);
    });

    //update a user's role
    app.patch("/update-role", verifyJWT, verifyADMIN, async (req, res) => {
      const { email, role } = req.body;
      const result = await usersCollection.updateOne(
        { email },
        { $set: { role } }
      );
      await sellerRequestCollection.deleteOne({ email });

      res.send(result);
    });

    //create unpaid order
    app.post("/orders", verifyJWT, async (req, res) => {
      try {
        const order = req.body;
        order.customer = req.tokenEmail;
        order.status = "pending";
        order.paymentStatus = "unpaid";
        order.createdAt = new Date();
        const result = await ordersCollection.insertOne(order);
        res.send({
          success: true,
          message: "order saved successfully",
          orderId: result.insertedId,
        });
      } catch (error) {
        console.log("Error", error);
        res.status(500).send({ success: false, message: "order failed" });
      }
    });

    //cancel order if any unpaid & pending
    app.patch("/order-cancel/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const result = await ordersCollection.updateOne(
        {
          _id: new ObjectId(id),
          customer: req.tokenEmail,
          status: "pending",
        },
        { $set: { status: "cancelled" } }
      );
      res.send(result);
    });

    //update order status(librarian)
    app.patch("/order/:id", async (req, res) => {
      const { id } = req.params;
      const { status } = req.body;
      const result = await ordersCollection.updateOne(
        {
          _id: new ObjectId(id),
          status: { $ne: "cancelled" },
          paymentStatus: { $ne: "paid" },
        },
        {
          $set: { status },
        }
      );
      res.send(result);
    });

    // await client.db("admin").command({ ping: 1 });
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
