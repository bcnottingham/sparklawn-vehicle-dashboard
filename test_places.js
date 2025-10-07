const fetch = require('node-fetch');
const apiKey = 'AIzaSyAjlKrXPJ2EUaMtIigsc65MFj7-lFNv26A';

(async () => {
    console.log('Testing Maverik at SW Regional Airport:');
    const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=36.336431,-94.253556&radius=50&key=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    console.log('Status:', data.status);
    if (data.results) data.results.slice(0,3).forEach(p => console.log(' -', p.name));
    if (data.error_message) console.log('ERROR:', data.error_message);
})();
