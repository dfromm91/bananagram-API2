import express from "express";
const app = express();
import http from "http";
import fs from "node:fs";
import { Server } from "socket.io";
import cors from "cors";
import axios from "axios";
app.use(cors({
  origin: "https://www.dannysprojects.xyz", // Your frontend origin
  methods: ["GET", "POST"],
  credentials: true, // Allow credentials (sessions)
}));

let openRooms = [];
import wordListPath from "word-list";
let singlePlayerRooms = 0;
let singles = {};

import session from "express-session";
import MongoStore from "connect-mongo";
import passportSocketIo from "passport.socketio";
import cookieParser from "cookie-parser";

// Session configuration (ensure this matches your OAuth server)
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "your_secret_key",
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
  cookie: {
    sameSite: "None", // For cross-site cookies
    secure: true, // Only true if using HTTPS in production
    maxAge: 1000 * 60 * 60 * 24, // 1 day
  },
});

// Use session and cookie parsing in WebSocket server
app.use(cookieParser());
app.use(sessionMiddleware);

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "https://bananagrams.onrender.com", // Correct CORS origin
    methods: ["GET", "POST"],
  },
});

io.use(passportSocketIo.authorize({
  cookieParser: cookieParser,
  key: 'connect.sid', // The cookie key, same as in your express session config
  secret: process.env.SESSION_SECRET || "your_secret_key", // Your session secret
  store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }), // Same session store as OAuth
  success: (data, accept) => { accept(null, true); }, // Successful connection
  fail: (data, message, error, accept) => { accept(null, false); }, // Failed connection
}));



// Read the word list into an array
const wordArray = fs.readFileSync(wordListPath, "utf8").split("\n");

// Convert the array to a dictionary (object) for O(1) lookups
const wordDictionary = {};
wordArray.forEach((word) => {
  wordDictionary[word.toLowerCase()] = true;
});

// Function to check if a word is in the word dictionary

const rooms = {}; // This will store the state for each room, including the tile bag and individual grids

function initializeTileBag(single = false) {
  const tileBag = {
    A: 13,
    B: 3,
    C: 3,
    D: 6,
    E: 18,
    F: 3,
    G: 4,
    H: 3,
    I: 12,
    J: 2,
    K: 2,
    L: 5,
    M: 3,
    N: 8,
    O: 11,
    P: 3,
    Q: 2,
    R: 9,
    S: 6,
    T: 9,
    U: 6,
    V: 3,
    W: 3,
    X: 2,
    Y: 3,
    Z: 2,
  };

  // const tileBag = {
  //   A: 15,
  // };

  if (single) {
    // Reduce the amount of each letter by half, rounding down
    Object.keys(tileBag).forEach((letter) => {
      tileBag[letter] = Math.max(1, Math.floor(tileBag[letter] / 2)); // Ensures at least 1 tile per letter
    });
  }

  return tileBag;
}
// setInterval(() => {
//   Object.keys(rooms).forEach((room) => {
//     const clients = io.sockets.adapter.rooms.get(room);

//     if (!clients || clients.size === 0) {
//       console.log(`Cleaning up empty room: ${room}`);
//       delete target[room];
//     }
//   });
// }, 60000);
function initializeGrid() {
  return Array.from({ length: 15 }, () => Array(15).fill(null)); // 10x10 grid initialized as a 2D array
}

function parseCrossword(grid) {
  const result = {};

  function addWord(word, locations) {
    if (word.length > 1) {
      // Ensure the word length is greater than 1
      result[word] = locations;
    }
  }

  function extractHorizontalWords() {
    for (let row = 0; row < grid.length; row++) {
      let word = "";
      let locations = [];
      for (let col = 0; col < grid[row].length; col++) {
        if (grid[row][col] !== null) {
          word += grid[row][col];
          locations.push([row, col]);
        } else {
          addWord(word, locations);
          word = "";
          locations = [];
        }
      }
      addWord(word, locations); // Add the last word in the row
    }
  }

  function extractVerticalWords() {
    for (let col = 0; col < grid[0].length; col++) {
      let word = "";
      let locations = [];
      for (let row = 0; row < grid.length; row++) {
        if (grid[row][col] !== null) {
          word += grid[row][col];
          locations.push([row, col]);
        } else {
          addWord(word, locations);
          word = "";
          locations = [];
        }
      }
      addWord(word, locations); // Add the last word in the column
    }
  }

  extractHorizontalWords();
  extractVerticalWords();

  return result;
}

function illegalWords(list) {
  let illegalwords = [];
  Object.keys(list).forEach((word) => {
    if (!wordDictionary[word.toLowerCase()]) {
      illegalwords.push(list[word]);
    }
  });
  return illegalwords;
}

io.on("connection", (socket) => {
  // console.log(`User connected: ${socket.id}`);
  socket.on("resetRoom", (room) => {
    if (target[room]) {
      console.log(`Resetting room: ${room}`);
      delete target[room]; // Remove the room state
    }
  });
  socket.on("connect", () => {
    console.log("Reconnected to the server");
  });

  socket.on("getOpenRooms", () => {
    io.emit("openRoomsUpdate", { openRooms });
  });

  socket.on(
    "joinRoom",
    ({ room, pname, pnum, googleId, gameStarted, single }) => {
      console.log(room, pname, pnum, googleId, single);
      console.log("joining room...");

      const target = single ? singles : rooms;

      if (!pname || !room) {
        socket.emit("receiveMessage", { message: "Please fill all fields" });
        return;
      }

      if (gameStarted) {
        if (target[room]) {
          socket.join(room);
          console.log("welcome back");
          socket.emit("receiveMessage", {
            message: target[room].names ? target[room].names : [],
            pnum: target[room].pnum,
            joined: target[room].joined,
          });
        } else {
          socket.emit("receiveMessage", { message: "Room full" });
        }
        return;
      } else {
        // Check if the room already exists
        if (target[room]) {
          // Check if the room is full
          if (target[room].names.length >= target[room].pnum) {
            socket.emit("receiveMessage", { message: "Room full" });
            return;
          }

          if (pnum) {
            console.log("tried to reset pnum");
            socket.emit("receiveMessage", {
              message:
                "Number of players already set for this game. Leave field blank if you want to join this game",
            });
            return;
          }
        } else {
          // Initialize the room if it doesn't exist
          if (!target[room]) {
            if ((pnum && parseInt(pnum) > 1 && parseInt(pnum) < 5) || single) {
              console.log("initializing");
              target[room] = {
                tileBag: initializeTileBag(single),
                players: {}, // Store each player's grid state
                names: [],
                pnum: parseInt(pnum),
                joined: 0,
                googleIds: [],
              };

              if (!single) {
                openRooms.push({ name: room, openSpots: pnum });
                io.emit("openRoomsUpdate", { openRooms });
              }
            } else {
              socket.emit("receiveMessage", {
                message: "Invalid # of players. 2-4 players allowed",
              });
              return;
            }
          }
        }

        // Add player to the room
        socket.join(room);
        socket.emit("gamestarted");
        target[room].names = [...target[room].names, pname];
        target[room].googleIds = [...target[room].googleIds, googleId];
        target[room].joined += 1;

        console.log("added a player");
        if (!single) {
          openRooms.filter((r) => r.name === room)[0].openSpots -= 1;
          if (openRooms.filter((r) => r.name === room)[0].openSpots < 1) {
            openRooms = openRooms.filter((r) => r.name !== room);
          }
          io.emit("openRoomsUpdate", { openRooms });
        }

        if (
          (target[room].names.length == 1 && pnum) ||
          (!pnum && target[room].names.length > 1)
        ) {
          console.log("updating rooms");
          socket.emit("updatepnum", target[room].pnum);
        }

        io.to(room).emit("updateOps", target[room].names);

        if (!target[room].players[googleId]) {
          target[room] = {
            ...target[room],
            players: {
              ...target[room].players,
              [googleId]: {
                grid: initializeGrid(),
              },
            },
          };
        }

        const names = target[room].names;
        io.to(room).emit("receiveMessage", {
          message: names,
          joined: target[room].joined,
          pnum: target[room].pnum,
        });

        socket.emit("initGame", {
          playerLetters: getRandomLetters(15, room, single),
          tiles: target[room].tileBag,
          grid: target[room].players[googleId].grid,
        });

        io.to(room).emit("updateTileBag", target[room].tileBag);
      }
    }
  );

  socket.on("bunch", ({ room, bunchTileRef, single }) => {
    const target = single ? singles : rooms;
    console.log("bunching...", bunchTileRef);

    target[room].tileBag[bunchTileRef.current] += 1;
    io.to(room).emit("updateTileBag", target[room].tileBag);
    const letter = getRandomLetters(3, room, single);
    console.log(letter);
    const type = "b";
    console.log("sending", letter);
    socket.emit("peeldraw", { letter, type });
    io.to(room).emit("updateTileBag", target[room].tileBag);
  });

  socket.on("getSinglePlayerRoom", () => {
    singlePlayerRooms += 1;
    console.log("single game initiated");
    socket.emit("receiveSinglePlayerRoom", { singlePlayerRooms });
  });

  socket.on("updateGrid", ({ newGridTiles, room, googleId, single }) => {
    const target = single ? singles : rooms;
    if (room && target[room]) {
      // Update this player's grid state
      target[room].players[googleId].grid = newGridTiles;
    }
    // console.log(illegalWords(parseCrossword(newGridTiles)));
    const illegal = illegalWords(parseCrossword(newGridTiles));

    socket.emit("wordLegality", { illegal });
  });

  socket.on("sendMessage", (data) => {
    console.log(data);
    socket.broadcast.emit("receiveMessage", data);
  });
  socket.on("peelclicked", async ({ room, pname, id, single }) => {
    const target = single ? singles : rooms;
    // Get all connected clients in the room
    const clients = io.sockets.adapter.rooms.get(room);

    console.log(
      Object.values(target[room].tileBag).reduce(
        (total, count) => total + count,
        0
      )
    );
    console.log("google id is " + id);

    if (
      Object.values(target[room].tileBag).reduce(
        (total, count) => total + count,
        0
      ) < clients.size
    ) {
      io.to(room).emit("receiveMessage", { message: `${pname} won!!` });

      // connect to db and update wins:
      try {
        const response = await axios.post("http://localhost:3001/update-wins", {
          googleId: id, // Send the Google ID to the auth API
        });

        if (response.data.success) {
          console.log(
            `Wins incremented for user with Google ID: ${id}. Current wins: ${response.data.wins}`
          );
        } else {
          console.error("Failed to increment wins:", response.data.message);
        }
      } catch (error) {
        console.error("Error communicating with the auth API:", error);
      }
      ////////////////////////////

      // now for the losers //////////////
      try {
        target[room].googleIds.forEach(async (player) => {
          if (player !== id) {
            // Skip the winner
            try {
              const lossResponse = await axios.post(
                "http://localhost:3001/update-losses",
                {
                  googleId: player, // Player's Google ID
                }
              );
              if (lossResponse.data.success) {
                console.log(`Losses incremented for player ${player}`);
              }
            } catch (error) {
              console.error(
                `Error updating losses for player ${player}:`,
                error
              );
            }
          }
        });
      } catch (error) {
        console.error("Error updating losses for players:", error);
      }
      /////////////////////////////////

      removeAllClientsFromRoom(room);
      delete target[room];

      return;
    }

    if (clients) {
      clients.forEach((clientId) => {
        const letter = getRandomLetters(1, room, single); // Draw a unique letter for each player
        console.log("sending", letter);
        io.to(clientId).emit("peeldraw", { letter }); // Send the drawn letter to the specific player
      });
    }
    io.to(room).emit("updateTileBag", target[room].tileBag);
  });

  socket.on("disconnect", () => {
    // console.log(`User disconnected: ${socket.id}`);
    // Optionally clean up the player's data from the room
  });
  // Server-side (Node.js with Socket.IO)
  socket.on("leaveRoom", ({ room, googleId, single }) => {
    // Logic to remove the player from the room
    const target = single ? singles : rooms;
    socket.leave(room);

    console.log(`${googleId} has left the room ${room}`);

    if (target[room]) {
      // Remove the player from the room's players object
      delete target[room].players[googleId];

      // If no players are left in the room, delete the room
      if (Object.keys(target[room].players).length === 0) {
        delete target[room];
        console.log(
          `Room ${room} has been deleted because it has no players left.`
        );
        openRooms = openRooms.filter((key) => key.name !== room);

        console.log(openRooms);
        io.emit("openRoomsUpdate", { openRooms });
      }
    }
    // You can broadcast a message to the room or take further actions here
  });
});

server.listen(3002, "0.0.0.0", () => {
  console.log("Server is running");
});
function removeAllClientsFromRoom(room) {
  const clients = io.sockets.adapter.rooms.get(room);

  if (clients) {
    clients.forEach((clientId) => {
      const clientSocket = io.sockets.sockets.get(clientId);
      if (clientSocket) {
        // Make the client leave the room without disconnecting the socket
        clientSocket.leave(room);
      }
    });
    console.log(`Removed all clients from room: ${room}`);
  } else {
    console.log(`No clients found in room: ${room}`);
  }
}

function getRandomLetters(num, room, single) {
  const letters = [];
  const target = single ? singles : rooms;
  const tileBag = { ...target[room].tileBag }; // Shallow copy of the tile bag

  // Flatten the tile bag into an array
  const flatTiles = [];
  for (const [letter, count] of Object.entries(tileBag)) {
    for (let i = 0; i < count; i++) {
      flatTiles.push(letter);
    }
  }

  // Pick random letters
  for (let i = 0; i < num; i++) {
    if (flatTiles.length === 0) break; // Stop if no more letters are available

    const randomIndex = Math.floor(Math.random() * flatTiles.length);
    const randomLetter = flatTiles[randomIndex];

    letters.push(randomLetter);

    // Remove the selected letter from the flatTiles array
    flatTiles.splice(randomIndex, 1);

    // Update the tile bag immutably
    tileBag[randomLetter] = (tileBag[randomLetter] || 0) - 1;
  }

  // Update the room's tile bag immutably
  target[room] = {
    ...target[room],
    tileBag: { ...tileBag },
  };

  return letters;
}
