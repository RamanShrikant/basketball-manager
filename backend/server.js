import app from "./app.js";

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`✅ Server started on port ${port}`));
