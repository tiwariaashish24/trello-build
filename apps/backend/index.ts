import express from "express";
import { prisma } from "@trello/db/client";

const app = express();
const PORT = 3000;

app.use(express.json());

app.post("/signup", async (req, res) => {
  const { username, password } = req.body ?? {};

  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "username and password are required" });
    return;
  }

  try {
    const user = await prisma.user.create({
      data: {
        username,
        password,
      },
    });

    res.json({
      message: "User created successfully",
      user: {
        id: user.id,
        username: user.username,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Failed to create user",
    });
  }
});

app.post("/signin", (req, res) => {

})

app.post("/organization", (req, res) => {

})

app.get("/boards", (req, res) => {

})


app.post("/board", (req, res) => {

})

app.delete("/board", (req, res) => {
  
})

app.delete("/organisation", (req, res) => {
  
})


app.post("/invite", (req, res) => {
  //emain and org id


  if(user === newUser){
    res.redirect("/signup")
  }
})




app.post("/accept", (req, res) => {
  //orgId: 

})

app.post("/section", (req, res) => {

})

app.put("/selection", (req, res) => {

})


app.post("/issue", (req, res) => {

})

app.get("/selections", (req, res) => {

})


app.get("/issues", (req, res) => {

})

app.get("/issues/:issueId", (req, res) => {

})

app.delete("/issue/:issueId", (req, res) => {

})

app.delete("/section", (req, res) => {
  
})

app.delete("/membership", (req, res) => {
  //userid and orgid
})

app.put("/board", (req, res) => {

})

app.put("/issue", (req, res) => {
  
})

app.post("/comment", (req, res) => {

})

app.put("/comment", (req, res) => {
  
})

app.delete("/comment", (req, res) => {
  
})


app.put("/issue/move", (req, res) => {

})


app.get("/organisation", (req, res) => {
  
})




















app.listen(PORT, () => {
  console.log(`Server is listen on ${PORT}`);
});
