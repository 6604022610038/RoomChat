const express = require("express")
const http = require("http")
const WebSocket = require("ws")
const path = require("path")
const { MongoClient } = require("mongodb")

const PORT = process.env.PORT || 8080

// MongoDB
const MONGO_URL = process.env.MONGO_URL
const client = new MongoClient(MONGO_URL)

let db
let Users
let Rooms

async function connectDB(){
    await client.connect()
    db = client.db("chatDB")

    Users = db.collection("users")
    Rooms = db.collection("rooms")

    console.log("MongoDB Connected")
}
connectDB()

const app = express()
const server = http.createServer(app)

app.use(express.static(path.join(__dirname)))

const wss = new WebSocket.Server({ server })

let clients = []
let roomUsers = {}

function sendUserRooms(ws, rooms){
    ws.send(JSON.stringify({
        type:"availableRooms",
        rooms:rooms.map(r=>({room:r}))
    }))
}

wss.on("connection",(ws)=>{

    ws.on("message",async(msg)=>{

        let data
        try{
            data = JSON.parse(msg)
        }catch{
            return
        }

        // REGISTER
        if(data.type === "register"){

            const exist = await Users.findOne({username:data.username})

            if(exist){
                ws.send(JSON.stringify({
                    type:"register",
                    success:false,
                    message:"มีผู้ใช้นี้แล้ว"
                }))
                return
            }

            await Users.insertOne({
                username:data.username,
                password:data.password,
                joinedRooms:[]
            })

            ws.send(JSON.stringify({
                type:"register",
                success:true
            }))
        }

        // LOGIN
        if(data.type === "login"){

            const user = await Users.findOne({
                username:data.username,
                password:data.password
            })

            if(!user){
                ws.send(JSON.stringify({
                    type:"login",
                    success:false,
                    message:"ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง"
                }))
                return
            }

            ws.username = data.username

            clients.push({
                ws,
                username:data.username,
                room:null
            })

            ws.send(JSON.stringify({
                type:"login",
                success:true
            }))

            sendUserRooms(ws,user.joinedRooms)
        }

        // CREATE / JOIN ROOM
        if(data.type === "createRoom" && ws.username){

    const roomName = data.room

    let room = await Rooms.findOne({room:roomName})

    if(!room){

        await Rooms.insertOne({
            room:roomName,
            password:data.password || "",
            history:[]
        })

        room = await Rooms.findOne({room:roomName})
    }

    ws.room = roomName

const clientEntry = clients.find(c=>c.ws===ws)
if(clientEntry) clientEntry.room = roomName

if(!roomUsers[roomName]) roomUsers[roomName] = []

if(!roomUsers[roomName].includes(ws.username)){
    roomUsers[roomName].push(ws.username)
}

broadcastRoomUsers(roomName)


    await Users.updateOne(
        {username:ws.username},
        {$addToSet:{joinedRooms:roomName}}
    )

    ws.send(JSON.stringify({
        type:"history",
        room:roomName,
        messages:room.history || []
    }))

    
}

        // MESSAGE
        if(data.type === "message" && ws.username && ws.room){

            const msgData = {
                type:"message",
                room:ws.room,
                from:ws.username,
                content:data.content,
                timestamp:new Date().toLocaleTimeString()
            }

            await Rooms.updateOne(
                {room:ws.room},
                {$push:{history:msgData}}
            )

            clients.forEach(c=>{
                if(
                    c.ws.readyState === WebSocket.OPEN &&
                    c.room === ws.room
                ){
                    c.ws.send(JSON.stringify(msgData))
                }
            })
        }

        // DELETE ROOM FOR USER
        if(data.type === "deleteUserRoom"){

            await Users.updateOne(
                {username:ws.username},
                {$pull:{joinedRooms:data.room}}
            )

            const user = await Users.findOne({username:ws.username})

            sendUserRooms(ws,user.joinedRooms)
        }

        // LOGOUT
        if(data.type === "logout"){

if(ws.room && roomUsers[ws.room]){
roomUsers[ws.room] =
roomUsers[ws.room].filter(u => u !== ws.username)

broadcastRoomUsers(ws.room)
}

clients = clients.filter(c=>c.ws!==ws)

ws.send(JSON.stringify({
type:"logout"
}))
}

    })

   ws.on("close", () => {

    if(ws.room && roomUsers[ws.room]){
        roomUsers[ws.room] =
            roomUsers[ws.room].filter(u => u !== ws.username)

        broadcastRoomUsers(ws.room)
    }

    clients = clients.filter(c => c.ws !== ws)

})
})



server.listen(PORT,()=>{
    console.log("Server running on http://localhost:"+PORT)
})

function broadcastRoomUsers(room){

    const users = roomUsers[room] || []

    const data = JSON.stringify({
        type: "roomUsers",
        room: room,
        users: users
    })

    wss.clients.forEach(client=>{
        if(client.readyState === WebSocket.OPEN && client.room === room){
            client.send(data)
        }
    })
}