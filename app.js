const express = require('express');
const app = express();
const port = 3000;

// Simple GET endpoint
app.get('/', (req, res) => {
  res.send('Hello World from Node.js API!');
});

// Example API endpoint
app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from the API!' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on port ${port}`);
});