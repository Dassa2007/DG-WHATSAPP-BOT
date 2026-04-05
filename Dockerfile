# Use node:20 as the base image
FROM node:20

# Install system dependencies required for the bot
RUN apt-get update && apt-get install -y \
    ffmpeg \
    imagemagick \
    graphicsmagick \
    libwebp-dev \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json OR yarn.lock
COPY package*.json ./

# Install project dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port specified in index.js
EXPOSE 7860

# Define the command to run the app
CMD ["node", "index.js"]
