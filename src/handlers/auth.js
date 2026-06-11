// Drop-in serverless replacement for the original cinemax-backend auth API.
// Same routes and response shapes as Auth.controller.js (Express + MongoDB),
// re-implemented on Lambda + DynamoDB. Users are keyed by email.
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');

const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.USERS_TABLE;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRE = process.env.JWT_EXPIRE || '7d';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const response = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  },
  body: JSON.stringify(body),
});

const getUser = async (email) =>
  (await db.send(new GetCommand({ TableName: TABLE, Key: { email } }))).Item;

const newOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

async function sendOTPEmail(to, otp) {
  await transporter.sendMail({
    from: `"App Xem Phim" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Mã xác nhận đăng ký',
    html: `
      <h2 style="color:#333;">Mã xác nhận của bạn là</h2>
      <h1 style="color:#333;">${otp}</h1>
      <p style="color:#333;">Mã có hiệu lực trong 5 phút</p>
      <p style="color:#333;">Nếu bạn không yêu cầu mã xác nhận này, vui lòng bỏ qua email này</p>
    `,
  });
}

const signToken = (user) =>
  jwt.sign({ authID: user.id }, JWT_SECRET, { expiresIn: JWT_EXPIRE });

const authPayload = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  avatar: user.avatar || null,
  provider: user.provider || 'local',
});

exports.handler = async (event) => {
  const route = (event.pathParameters && event.pathParameters.proxy) || '';
  console.log('Request:', event.httpMethod, event.path);

  try {
    // PUT /api/user/{userId} — profile update (name, avatar, password)
    if ((event.path || '').startsWith('/api/user/')) {
      if (event.httpMethod !== 'PUT') return response(405, { success: false, message: 'Method not allowed' });
      return updateUser(event, route);
    }

    if (event.httpMethod !== 'POST') return response(405, { success: false, message: 'Method not allowed' });
    const body = JSON.parse(event.body || '{}');

    switch (route) {
      case 'register': return register(body);
      case 'login': return login(body);
      case 'verify-email': return verifyEmail(body);
      case 'google-login': return googleLogin(body);
      case 'resend-verify-otp': return resendVerifyOtp(body);
      case 'forgot-password': return forgotPassword(body);
      case 'reset-password': return resetPassword(body);
      default: return response(404, { success: false, message: 'Not found' });
    }
  } catch (err) {
    console.error('Error:', err);
    return response(500, { success: false, message: 'Internal server error' });
  }
};

// PUT /api/user/{userId} {name?, avatar?, password?}
// - Google accounts have no password -> changing it is rejected
// - avatar may be a data-URI (base64) -> stored on S3, or a plain URL
async function updateUser(event, userId) {
  const header = (event.headers && (event.headers.Authorization || event.headers.authorization)) || '';
  const token = header.replace(/^Bearer\s+/i, '');
  let authId;
  try {
    authId = jwt.verify(token, JWT_SECRET).authID;
  } catch {
    return response(401, { success: false, message: 'Chưa đăng nhập' });
  }
  if (authId !== userId) return response(403, { success: false, message: 'Không có quyền' });

  const found = await db.send(new (require('@aws-sdk/lib-dynamodb').QueryCommand)({
    TableName: TABLE,
    IndexName: 'id-index',
    KeyConditionExpression: 'id = :i',
    ExpressionAttributeValues: { ':i': userId },
    Limit: 1,
  }));
  const user = found.Items && found.Items[0];
  if (!user) return response(404, { success: false, message: 'User not found' });

  const body = JSON.parse(event.body || '{}');
  const sets = [];
  const values = {};
  const names = {};

  if (body.name && body.name.trim()) {
    sets.push('#nm = :n');
    names['#nm'] = 'name';
    values[':n'] = body.name.trim();
    user.name = values[':n'];
  }

  if (body.password) {
    if (user.provider === 'google') {
      return response(400, { success: false, message: 'Tài khoản Google không dùng mật khẩu' });
    }
    if (body.password.length < 6) {
      return response(400, { success: false, message: 'Mật khẩu phải từ 6 ký tự' });
    }
    sets.push('password = :p');
    values[':p'] = await bcrypt.hash(body.password, 10);
  }

  if (body.avatar) {
    let avatarUrl = body.avatar;
    const dataUri = /^data:(image\/\w+);base64,(.+)$/s.exec(body.avatar);
    if (dataUri) {
      const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
      const s3 = new S3Client({});
      const bucket = process.env.POSTERS_BUCKET;
      const ext = dataUri[1] === 'image/png' ? 'png' : 'jpg';
      const key = `posters/avatars-${userId}.${ext}`;
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: Buffer.from(dataUri[2], 'base64'),
        ContentType: dataUri[1],
        CacheControl: 'no-cache',
      }));
      avatarUrl = `https://${bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
    }
    sets.push('avatar = :a');
    values[':a'] = avatarUrl;
    user.avatar = avatarUrl;
  }

  if (sets.length === 0) return response(400, { success: false, message: 'Không có gì để cập nhật' });

  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { email: user.email },
    UpdateExpression: 'SET ' + sets.join(', '),
    ...(Object.keys(names).length ? { ExpressionAttributeNames: names } : {}),
    ExpressionAttributeValues: values,
  }));

  return response(200, { success: true, message: 'Cập nhật thành công', user: authPayload(user) });
}

async function register({ name, email, password }) {
  if (!email || !password) return response(400, { success: false, message: 'Email and password are required' });

  if (await getUser(email)) return response(400, { success: false, message: 'Email already exists' });

  if (password.length < 6) return response(400, { success: false, message: 'Password must be at least 6 characters' });

  const otp = newOtp();
  await db.send(new PutCommand({
    TableName: TABLE,
    Item: {
      email,
      id: crypto.randomUUID(),
      name: name || '',
      password: await bcrypt.hash(password, 10),
      otp,
      otpExpires: Date.now() + 5 * 60 * 1000,
      otpResendCount: 0,
      isVerified: false,
      provider: 'local',
      createdAt: new Date().toISOString(),
    },
  }));

  await sendOTPEmail(email, otp);
  return response(200, { success: true, message: 'OTP has been sent to your email' });
}

async function login({ email, password }) {
  const user = email && (await getUser(email));
  if (!user || !user.password) return response(401, { success: false, message: 'Invalid email or password' });

  if (!(await bcrypt.compare(password || '', user.password))) {
    return response(400, { success: false, message: 'Invalid email or password' });
  }

  if (!user.isVerified) return response(400, { success: false, message: 'Please verify your email' });

  return response(200, { success: true, token: signToken(user), auth: authPayload(user) });
}

async function verifyEmail({ email, otp }) {
  const user = email && (await getUser(email));
  if (!user || user.otp !== otp || (user.otpExpires || 0) < Date.now()) {
    return response(400, { success: false, message: 'Invalid or expired OTP' });
  }

  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { email },
    UpdateExpression: 'SET isVerified = :t, otpResendCount = :z REMOVE otp, otpExpires, otpLastSentAt',
    ExpressionAttributeValues: { ':t': true, ':z': 0 },
  }));

  return response(200, { success: true, message: 'Email verified successfully' });
}

async function googleLogin({ googleToken }) {
  if (!googleToken) return response(400, { success: false, message: 'Google token is required' });

  const ticket = await googleClient.verifyIdToken({
    idToken: googleToken,
    audience: [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_ANDROID_CLIENT_ID].filter(Boolean),
  });
  const { email, name, sub: googleId, picture } = ticket.getPayload();

  let user = await getUser(email);

  if (user && user.provider === 'local') {
    return response(400, { success: false, message: 'Email already registered with password' });
  }

  if (!user) {
    user = {
      email,
      id: crypto.randomUUID(),
      name: name || '',
      googleId,
      avatar: picture || null,
      provider: 'google',
      isVerified: true,
      createdAt: new Date().toISOString(),
    };
    await db.send(new PutCommand({ TableName: TABLE, Item: user }));
  } else if (picture && !user.avatar) {
    user.avatar = picture;
    await db.send(new UpdateCommand({
      TableName: TABLE,
      Key: { email },
      UpdateExpression: 'SET avatar = :a',
      ExpressionAttributeValues: { ':a': picture },
    }));
  }

  return response(200, { success: true, token: signToken(user), auth: authPayload(user) });
}

async function resendVerifyOtp({ email }) {
  const user = email && (await getUser(email));
  if (!user) return response(400, { success: false, message: 'Email not found' });
  if (user.isVerified) return response(400, { success: false, message: 'Email already verified' });

  const now = Date.now();
  if (user.otpLastSentAt && now - user.otpLastSentAt < 60 * 1000) {
    return response(429, { success: false, message: 'Please wait before resending OTP' });
  }
  if ((user.otpResendCount || 0) >= 3) {
    return response(429, { success: false, message: 'OTP resend limit reached, please try later' });
  }

  const otp = newOtp();
  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { email },
    UpdateExpression: 'SET otp = :o, otpExpires = :e, otpResendCount = :c, otpLastSentAt = :n',
    ExpressionAttributeValues: {
      ':o': otp,
      ':e': now + 5 * 60 * 1000,
      ':c': (user.otpResendCount || 0) + 1,
      ':n': now,
    },
  }));

  await sendOTPEmail(email, otp);
  return response(200, { success: true, message: 'OTP resend successfully' });
}

async function forgotPassword({ email }) {
  const user = email && (await getUser(email));
  if (!user) return response(400, { success: false, message: 'Email not found' });

  if (user.resetOtpExpires && user.resetOtpExpires > Date.now()) {
    return response(429, { success: false, message: 'Please wait before requesting another OTP' });
  }

  const otp = newOtp();
  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { email },
    UpdateExpression: 'SET resetOtp = :o, resetOtpExpires = :e',
    ExpressionAttributeValues: { ':o': otp, ':e': Date.now() + 5 * 60 * 1000 },
  }));

  await sendOTPEmail(email, otp);
  return response(200, { success: true, message: 'OTP sent to reset password' });
}

async function resetPassword({ email, otp, newPassword }) {
  const user = email && (await getUser(email));
  if (!user || user.resetOtp !== otp || (user.resetOtpExpires || 0) < Date.now()) {
    return response(400, { success: false, message: 'Invalid or expired OTP' });
  }

  if (!newPassword || newPassword.length < 6) {
    return response(400, { success: false, message: 'New password must be at least 6 characters' });
  }

  await db.send(new UpdateCommand({
    TableName: TABLE,
    Key: { email },
    UpdateExpression: 'SET password = :p REMOVE resetOtp, resetOtpExpires',
    ExpressionAttributeValues: { ':p': await bcrypt.hash(newPassword, 10) },
  }));

  return response(200, { success: true, message: 'Password reset successfully' });
}
