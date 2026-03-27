export default function middleware(req) {
  const auth = req.headers.get('authorization');
  const valid = 'Basic ' + btoa(
    process.env.BASIC_AUTH_USER + ':' + process.env.BASIC_AUTH_PASS
  );
  if (auth !== valid) {
    return new Response('Unauthorized', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Saber Tracker"' }
    });
  }
}

export const config = {
  matcher: ['/((?!_next).*)'],
};