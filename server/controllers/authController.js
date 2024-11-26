const User = require('./../models/userModel');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const AppError = require('./../utils/appError');
const catchAsync = require('./../utils/catchAsync');
const sendEmail = require('./../utils/email');
const crypto = require('crypto');

const Mailgen = require('mailgen');

const mailGenerator = new Mailgen({
  theme: 'cerberus',
  product: {
    name: 'CampusUnify',
    link: 'https://campusunify.pranavpore.com/',
    logo: 'https://campusunify.pranavpore.com/logo.png',
  },
});

exports.restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role))
      return next(
        new AppError('You do not have permission to perform this action', 403),
      );
    next();
  };
};

const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user._id);

  const cookieOptions = {
    expiresIn: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES_IN + 86400000,
    ),
    httpOnly: true,
    SameSite: 'none',
  };

  if (process.env.NODE_ENV === 'production') cookieOptions.secure = true;
  const {password, ...rest } = user._doc;

  res.cookie('jwt', token, cookieOptions).status(statusCode).json({
    status: 'success',
    user: rest,
  });
};

exports.protect = catchAsync(async (req, res, next) => {
  const token = req.cookies.jwt;
  if (!token || token === 'null')
    return next(new AppError('User is not logged in', 401));

  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);

  const freshUser = await User.findById(decoded.id);
  if (!freshUser) return next(new AppError('User does not exist', 401));

  if (await freshUser.changedPasswordAfter(decoded.iat))
    return next(new AppError('Password was changed. Login again', 401));

  req.user = freshUser;
  next();
});

exports.isLoggedIn = catchAsync(async (req, res, next) => {
  if (req.cookies.jwt) {
    const decoded = await promisify(jwt.verify)(
      req.cookies.jwt,
      process.env.JWT_SECRET,
    );

    const freshUser = await User.findById(decoded.id);
    if (!freshUser) return next();

    if (await freshUser.changedPasswordAfter(decoded.iat)) return next();

    res.locals.user = freshUser;
  }
  next();
});

exports.signup = catchAsync(async (req, res, next) => {
  const { name, email, role, password, passwordConfirm } = req.body;

  const existingUser = await User.findOne({ email });
  if (existingUser && existingUser.isVerified) {
    return next(new AppError('Email already in use', 400));
  }

  const otp = sendEmail.generateOTP();
  const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  const newUser = await User.create({
    name,
    email,
    role,
    password,
    passwordConfirm,
    otp,
    otpExpires,
  });

  const options = {
    email,
    subject: 'Email Verification for CampusUnify',
    emailBody: `
      <h1>Welcome to CampusUnify!</h1>
      <p>Your verification code is: <strong>${otp}</strong></p>
      <p>This code will expire in 10 minutes.</p>
    `,
  };

  try {
    await sendEmail.SEND(options); // Use sendEmail function from email.js
    res.status(201).json({
      status: 'success',
      message: 'User created. Please verify your email.',
    });
  } catch (error) {
    await User.findByIdAndDelete(newUser._id);
    return next(new AppError('Error sending verification email. Please try again.', 500));
  }
});

exports.login = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

  const user = await User.findOne({ email }).select('+password');

  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect email or password entered', 401));
  }

  createSendToken(user, 200, res);
});

exports.verifyEmail = catchAsync(async (req, res, next) => {
  const { email, otp } = req.body;

  const user = await User.findOne({
    email,
    otp,
    otpExpires: { $gt: Date.now() },
  });

  if (!user) {
    return next(new AppError('Invalid or expired OTP', 400));
  }

  user.isVerified = true;
  user.otp = undefined;
  user.otpExpires = undefined;
  await user.save({ validateBeforeSave: false });

  createSendToken(user, 200, res);
});

exports.forgotPassword = catchAsync(async (req, res, next) => {
  if (!req.body.email)
    return next(new AppError('Please enter a email ID', 400));
  const user = await User.findOne({ email: req.body.email });
  if (!user)
    return next(new AppError('No user with the specified email exists', 404));
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  const email = {
    body: {
      name: user.name,
      intro:
        'You have received this email because a password reset request for your account was received.',
      action: {
        instructions: 'Click the button below to reset your password:',
        button: {
          color: '#E67E22',
          text: 'Reset your password',
          link: `https://campusunify.pranavpore.com/reset-password/${resetToken}`,
        },
      },
      outro:
        'If you did not request a password reset, no further action is required on your part.',
    },
  };

  const emailBody = mailGenerator.generate(email);

  try {
    await sendEmail({
      email: req.body.email,
      subject: 'Password Reset Token',
      emailBody,
    });
  } catch {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    return next(
      new AppError(
        'There was an error while sending email. Try again later',
        500,
      ),
    );
  }
  res.status(200).json({
    status: 'success',
    message: 'Token sent to email!',
  });
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  if (!user) return next(new AppError('Token is invalid or expired', 400));

  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;

  await user.save();

  createSendToken(user, 200, res);
});

exports.updatePassword = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.user.id).select('password');

  if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
    return next(
      new AppError('You have entered the wrong current password', 401),
    );
  }

  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;

  await user.save();
  createSendToken(user, 200, res);
});

exports.oAuth = catchAsync(async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (user) {
    createSendToken(user, 200, res);
  } else {
    const generatedPassword =
      Math.random().toString(36).slice(-8) +
      Math.random().toString(36).slice(-8);

    const newUser = await User.create({
      name:
        req.body.name.split(' ').join('').toLowerCase() +
        Math.random().toString(36).slice(-4),
      email: req.body.email,
      password: generatedPassword,
      passwordConfirm: generatedPassword,
      avatar: req.body.photo,
    });

    createSendToken(newUser, 201, res);
  }
});

exports.logout = (req, res) => {
  res.clearCookie('jwt').status(200).json({
    status: 'success',
    data: null,
  });
};

exports.deleteMe = catchAsync(async (req, res, next) => {
  await User.findByIdAndUpdate(req.user.id, { active: false });

  res.status(204).json({
    status: 'success',
    data: null,
  });
});
