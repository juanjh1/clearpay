import hashlib
import time
import uuid
import json
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

# ==========================
# CORS (para producción demo)
# ==========================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================
# USERS STORAGE
# ==========================

USERS_FILE = "users.json"

def load_users():
    if not os.path.exists(USERS_FILE):
        with open(USERS_FILE, "w") as f:
            json.dump({"users": []}, f)

    with open(USERS_FILE, "r") as f:
        return json.load(f)

def save_users(data):
    with open(USERS_FILE, "w") as f:
        json.dump(data, f, indent=2)

# ==========================
# AUTH MODELS
# ==========================

class RegisterRequest(BaseModel):
    email: str
    password: str
    role: str
    wallet: str

class LoginRequest(BaseModel):
    email: str
    password: str

# ==========================
# REGISTER
# ==========================

@app.post("/register")
async def register(data: RegisterRequest):

    users_data = load_users()

    for user in users_data["users"]:
        if user["email"] == data.email:
            return {"error": "User already exists"}

        if user["wallet"] == data.wallet and user["role"] == data.role:
                return {"error": f"This wallet already has a {data.role} account"}

    if data.role not in ["admin", "employee"]:
        return {"error": "Invalid role"}

    new_user = {
        "email": data.email,
        "password": data.password,   # 🔥 simple
        "role": data.role,
        "wallet": data.wallet
    }

    users_data["users"].append(new_user)
    save_users(users_data)

    return {"message": "User registered successfully"}

# ==========================
# LOGIN
# ==========================

@app.post("/login")
async def login(data: LoginRequest):

    users_data = load_users()

    for user in users_data["users"]:

        if user["email"] == data.email:

            if user["password"] != data.password:
                return {"error": "Invalid password"}

            return {
                "message": "Login successful",
                "role": user["role"],
                "registeredWallet": user["wallet"]
            }

    return {"error": "User not found"}

# ==========================
# CHALLENGE (QR)
# ==========================

CURRENT_CHALLENGE = None
CHALLENGE_EXPIRATION = 0

def generate_challenge():
    global CURRENT_CHALLENGE, CHALLENGE_EXPIRATION

    random_seed = str(uuid.uuid4()) + str(time.time())
    CURRENT_CHALLENGE = hashlib.sha256(random_seed.encode()).hexdigest()
    CHALLENGE_EXPIRATION = int(time.time()) + 60

@app.get("/challenge")
def get_challenge():
    global CURRENT_CHALLENGE, CHALLENGE_EXPIRATION

    if time.time() > CHALLENGE_EXPIRATION:
        generate_challenge()

    return {
        "challenge": CURRENT_CHALLENGE,
        "expires": CHALLENGE_EXPIRATION
    }

generate_challenge()

COMMENTS_FILE = "comments.json"

def load_comments():
    if not os.path.exists(COMMENTS_FILE):
        return []
    with open(COMMENTS_FILE, "r") as f:
        return json.load(f)

def save_comments(data):
    with open(COMMENTS_FILE, "w") as f:
        json.dump(data, f, indent=2)

class CommentRequest(BaseModel):
    email: str
    comment: str

@app.post("/comment")
async def save_comment(data: CommentRequest):
    comments = load_comments()

    new_comment = {
        "email": data.email,
        "comment": data.comment,
        "timestamp": int(time.time())
    }

    comments.append(new_comment)
    save_comments(comments)

    return {"message": "Comment saved"}

@app.get("/admin/comments")
async def get_comments():
    return load_comments()

# ==========================
# Employer Screen
# ==========================

@app.get("/admin/employees")
async def get_employees():

    users_data = load_users()

    employees = [
        {
            "email": u["email"],
            "wallet": u["wallet"]
        }
        for u in users_data["users"]
        if u["role"] == "employee"
    ]

    return employees

