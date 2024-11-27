const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const Event = require('../models/eventModel');
const Bookings = require('../models/bookingsModel');
const APIFeatures = require('./../utils/apiFeatures');

exports.getLatestEvents = catchAsync(async (req, res) => {
  const latestEvents = await Event.getLatestEvents();
  res.status(200).json({
    status: 'success',
    data: latestEvents,
  });
});

exports.getAllEvents = catchAsync(async (req, res) => {
  let filter;

  if (req.user.role === 'club') filter = { clubId: req.user.id };

  const features = new APIFeatures(
    Event.find(filter).populate('bookings'),
    req.query,
  )
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const fetchedEvents = await features.query;

  res.status(200).json({
    status: 'success',
    results: fetchedEvents.length,
    data: fetchedEvents,
  });
});

exports.getSingleEvent = catchAsync(async (req, res, next) => {
  const fetchedEvent = await Event.findById(req.params.id)
    .populate('bookings clubId')
    .select('-bookings');

  if (!fetchedEvent) {
    return next(
      new AppError(`Event with id ${req.params.id} does not exist`, 404),
    );
  }

  if (
    req.user.role === 'club' &&
    !isAuthorized(req.user.id, fetchedEvent, true)
  )
    return next(
      new AppError(`You are unauthorized to perform this action`, 403),
    );

  res.status(200).json({
    status: 'success',
    data: fetchedEvent,
  });
});

exports.createEvent = catchAsync(async (req, res, next) => {
  const eventData = req.body;
  if (new Date(eventData.date) < new Date())
    return next(
      new AppError('Cannot create an event for a day in the past', 403),
    );

  eventData.clubId = req.user.id;

  const newEvent = await Event.create(eventData);
  await Bookings.create({
    eventId: newEvent._id,
    registeredUsers: [],
  });

  res.status(201).json({
    status: 'success',
    data: newEvent,
  });
});

exports.updateEvent = catchAsync(async (req, res, next) => {
  const fetchedEvent = await Event.findById(req.params.id);
  if (!fetchedEvent) {
    return next(
      new AppError(`There is no event with the id ${req.params.id}`, 404),
    );
  }

  if (!isAuthorized(req.user.id, fetchedEvent)) {
    return next(
      new AppError('You are unauthorized to perform this action', 403),
    );
  }

  delete req.body.days;

  const updatedEvent = await Event.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  res.status(200).json({
    status: 'success',
    data: updatedEvent,
  });
});

exports.deleteEvent = catchAsync(async (req, res, next) => {
  const fetchedEvent = await Event.findById(req.params.id);
  if (!fetchedEvent) {
    return next(
      new AppError(`There is no event with the id ${req.params.id}`, 404),
    );
  }

  if (!isAuthorized(req.user.id, fetchedEvent)) {
    return next(
      new AppError('You are unauthorized to perform this action', 403),
    );
  }

  const deletedEvent = await Event.findByIdAndDelete(req.params.id);

  res.status(204).json({
    status: 'success',
    data: deletedEvent,
  });
});

exports.getEventDay = catchAsync(async (req, res, next) => {
  const fetchedEvent = await Event.findById(req.params.eventId);
  if (!fetchedEvent) {
    return next(
      new AppError(`No event with the given ${req.params.eventId} exists`, 404),
    );
  }

  const fetchedEventDay = fetchedEvent.days.id(req.params.dayId);
  if (!fetchedEventDay) {
    return next(
      new AppError(
        `No event day with the given ${req.params.dayId} exists`,
        404,
      ),
    );
  }

  res.status(200).json({
    status: 'success',
    data: fetchedEventDay,
  });
});

exports.getAllEventDays = catchAsync(async (req, res, next) => {
  const fetchedEvent = await Event.findById(req.params.eventId);
  if (!fetchedEvent) {
    return next(
      new AppError(`No event with ${req.params.eventId} exists`, 404),
    );
  }

  res.status(200).json({
    status: 'success',
    data: fetchedEvent.days,
  });
});

exports.createEventDay = catchAsync(async (req, res, next) => {
  if (new Date(req.body.date) < new Date())
    return next(new AppError('Cannot create an event day in the past', 403));

  const fetchedEvent = await Event.findById(req.params.eventId);

  if (!fetchedEvent) {
    return next(
      new AppError(`No event with the given ${req.params.eventId} exists`, 404),
    );
  }

  if (!isAuthorized(req.user.id, fetchedEvent)) {
    return next(
      new AppError('You are not authorized to eprform this action', 403),
    );
  }

  fetchedEvent.days.push(req.body);
  await fetchedEvent.save();

  res.status(201).json({
    status: 'success',
    data: fetchedEvent,
  });
});

exports.updateEventDay = catchAsync(async (req, res, next) => {
  const fetchedEvent = await Event.findById(req.params.eventId);
  if (!fetchedEvent) {
    return next(
      new AppError(`No event with the given ${req.params.eventId} exists`, 404),
    );
  }

  if (!isAuthorized(req.user.id, fetchedEvent)) {
    return next(
      new AppError('You are unauthorized to perform this action', 403),
    );
  }

  const updationDay = fetchedEvent.days.find(
    (day) => day._id.toString() === req.params.dayId,
  );

  if (!updationDay) {
    return next(
      new AppError(`There is no event day with the id ${req.params.dayId}`),
    );
  }

  Object.assign(updationDay, req.body);
  await fetchedEvent.save();

  res.status(200).json({
    status: 'success',
    data: fetchedEvent,
  });
});

exports.deleteEventDay = catchAsync(async (req, res, next) => {
  const fetchedEvent = await Event.findById(req.params.eventId);
  if (!fetchedEvent) {
    return next(
      new AppError(`No event with the given ${req.params.eventId} exists`, 404),
    );
  }

  if (!isAuthorized(req.user.id, fetchedEvent)) {
    return next(
      new AppError('You are unauthorized to perform this action', 403),
    );
  }

  const deletionDay = fetchedEvent.days.id(req.params.dayId);
  if (!deletionDay) {
    return next(
      new AppError(`There is no event day with the id ${req.params.dayId}`),
    );
  }

  fetchedEvent.days.pull(req.params.dayId);
  await fetchedEvent.save();

  res.status(204).json({
    status: 'success',
    data: fetchedEvent,
  });
});

function isAuthorized(userId, fetchedEvent, singleEventFlag) {
  if (singleEventFlag)
    return userId.toString() === fetchedEvent.clubId._id.toString();
  return userId.toString() === fetchedEvent.clubId.toString();
}
