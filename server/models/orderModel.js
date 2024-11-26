const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  internalOrderId: {
    type: String,
    required: true,
    unique: [true, 'Order ID is required for the order'],
  },
  userId: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: [true, 'A user should be associated with the order'],
  },
  orderItems: {
    type: [mongoose.Schema.ObjectId],
    ref: 'Event',
    required: [true, 'There should be atleast one event in the order'],
  },
  totalAmount: {
    type: Number,
    required: [true, 'There should be a total amount associated with an order'],
  },
  razorpayOrderId: {
    type: String,
    required: [
      true,
      'There should be an razorpay order id associated with an order',
    ],
  },
  status: {
    type: String,
    enum: ['created', 'captured', 'failed'],
    default: 'created',
    required: [true, 'There should be a current status of the order'],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

orderSchema.pre(/^find/, function (next) {
  this.select('-__v');
  next();
});

const orderModel = mongoose.model('Order', orderSchema);

module.exports = orderModel;
