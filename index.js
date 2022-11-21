const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config()
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const port = process.env.PORT || 5000;
const app = express();


//middle ware
app.use(cors());
app.use(express.json());



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.wc7jl9l.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });


function verifyJWT(req,res,next){
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        return res.status(401).send('unauthorized access')
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_WEB_TOKEN, function(err,decoded){
        if (err) {
            return res.status(403).send({message:'forbidden access'})
        }
        req.decoded = decoded;
        next()
    })
}

async function run() {
    try {
        const appointmentOptionCollection = client.db('doctorsPortal').collection('appointmentOptions');
        const bookingCollection = client.db('doctorsPortal').collection('bookings');
        const usersCollection = client.db('doctorsPortal').collection('users');
        const doctorsCollection = client.db('doctorsPortal').collection('doctors');
        const paymentsCollection = client.db('doctorsPortal').collection('payments');
         //make sure you use verifyAdmin after verifyJWT
        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersCollection.findOne(query);

            if (user?.role !== 'admin') {
                return res.status(403).send({message: 'forbidden access'})
            }
            next()
        }

        // use Aggregate to query multiple collectin and then merge data
        app.get('/appointmentOption', async (req, res) => {
            const date = req.query.date;
          
            const query = {};
            const options = await appointmentOptionCollection.find(query).toArray();
            const bookingQuery = { appintmentDate: date }
            const alreadyBooked = await bookingCollection.find(bookingQuery).toArray();
             //code carefully
            options.forEach(option => {
                const optionBooked = alreadyBooked.filter(book => book.treatment === option.name)

                const bookedSlots = optionBooked.map(book => book.slot)
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlots
            } )

            res.send(options)

        })

        app.get('/appointmentSpecialty', async (req, res) => {
            const query = {}
            const result = await appointmentOptionCollection.find(query).project({name: 1}).toArray();
            res.send(result)
        })

        app.get('/bookings',verifyJWT, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.query.email;

            if (email !== decodedEmail) {
                return res.status(403).send({message: 'forbidden access'})
            }
          
            const query = {
                email: email
            }
            const bookings = await bookingCollection.find(query).toArray() 
            res.send(bookings)
        })

        app.get('/bookings/:id', async (req, res)=>{
            const id = req.params.id;
            const query = { _id: ObjectId(id) };
            const booking = await bookingCollection.findOne(query);
            res.send(booking)

        })

        app.post('/bookings', async (req, res)=>{
            const booking = req.body;

            const query = {
                appintmentDate: booking.appintmentDate,
                treatment: booking.treatment,
                email:booking.email
            }

            const alreadyBooked = await bookingCollection.find(query).toArray();
            if (alreadyBooked.length) {
                const message = `you already have a booking on ${booking.appintmentDate}`
                return res.send({acknowledged: false,message})
            }
            
            const result = await bookingCollection.insertOne(booking)
            res.send(result)
        })

        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = {email: email}
            const user = await usersCollection.findOne(query);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_WEB_TOKEN, { expiresIn: '1d' })
                return res.send({accessToken: token})
            }
           
            res.status(403).send({accessToken: ''})
        })

         app.post('/create-payment-intent', async (req, res) => {
            const booking = req.body;
            const price = booking.price;
            const amount = price * 100;

            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                ]
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });
        
        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment)
            const id = payment.bookingId;
            const filter = { _id: ObjectId(id) }
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId
                }
            }
            const updateResult = await bookingCollection.updateOne(filter,updatedDoc)
            res.send(result)
        })

        app.get('/users', async (req, res) => {
            const query = {};
            const users = await usersCollection.find(query).toArray()
            res.send(users)
        })

        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = {email}
            const user = await usersCollection.findOne(query);
            res.send({isAdmin: user?.role === 'admin'})
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
          
            const result = await usersCollection.insertOne(user);
            res.send(result)
        })

        app.put('/users/admin/:id', verifyJWT,verifyAdmin, async (req, res) => {
            
          
            const id = req.params.id;
            const filter = { _id: ObjectId(id) }
            const option = {upsert: true}
            const updatedDoc = {
                $set: {
                  role: 'admin'  
                }
            }
            const result = await usersCollection.updateOne(filter, updatedDoc, option)
            res.send(result)
        })

        //temporary to update price field on appintment option

        // app.get('/addPrice', async (req, res) => {
        //     const filter = {};
        //     const option = { upsert: true };
        //      const updatedDoc = {
        //         $set: {
        //           price: 99
        //         }
        //     }
        //     const result = await appointmentOptionCollection.updateMany(filter, updatedDoc, option)
            
        //     res.send(result)
        // })


        app.get('/doctors',verifyJWT,verifyAdmin, async (req, res) => {
            const query = {};
            const doctors = await doctorsCollection.find(query).toArray();
            res.send(doctors)
        })

        app.post('/doctors',verifyJWT,verifyAdmin, async (req, res) => {
            const doctor = req.body;
            const result = await doctorsCollection.insertOne(doctor)
            res.send(result)
        })

        app.delete('/doctors/:id',verifyJWT,verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const query = { _id: ObjectId(id) }
            const result = await doctorsCollection.deleteOne(query);
            res.send(result)
        })
    }
    finally {
        
    }
}
run().catch(error=> console.log(error))



app.get('/', (req, res) => {
    res.send('Doctor portal running..')
})

app.listen(port, () => {
    console.log(`dortor portal is running ${port}`)
})