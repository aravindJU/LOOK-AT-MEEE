![](https://github.com/user-attachments/assets/8920b256-2ba8-4988-b824-5351134eb4bd "git (1)")

# LOOK AT ME 🎯

## Basic Details

### Team Name: FaceFun

### Team Members

- Team Lead: Aravind Pattath Niraj – Jain University Kochi

### Project Description

This project is an attention-monitoring web app that uses your webcam to track whether you are looking at the screen. If you look away, it interrupts you with a meme reel, counts your distractions, and lets you record and download your session.

### The Problem (that doesn't exist)

The terrifying productivity crisis of eyes accidentally blinking, resting, or looking at a window instead of staring unblinkingly at a glowing rectangle for eight straight hours.

### The Solution (that nobody asked for)

A magic laser beam that glues your eyeballs straight ahead and shoots funny pictures into your eyes whenever you try to look away.

## Technical Details

### Technologies Used

- Languages used: Python, HTML, CSS, JavaScript

- Frameworks used: Flask, Jinja2

- Libraries used: MediaPipe (for face/gaze tracking), Werkzeug, standard Python libraries (io, os, sqlite3, subprocess, tempfile)

- Tools used: Render, Git, FFmpeg


### Implementation

For Software:

# Installation

```bash
python3 -m venv venv
source venv/bin/activate
python -m pip install -r requirements.txt
```

# Run

```bash
python app.py
```

Open http://127.0.0.1:5001 in a browser. On Mac/Linux, activate the environment with
`source venv\bin\activate` instead.

### Project Documentation

For Software:

# Screenshots (Add at least 3)

<img width="1470" height="956" alt="Screenshot 2026-09-05 at 5 25 17 AM" src="https://github.com/user-attachments/assets/b0d4b8bb-c07b-4130-af24-355b20dfcf88" />

Webcam feed

<img width="1121" height="493" alt="Screenshot 2026-09-05 at 5 25 58 AM" src="https://github.com/user-attachments/assets/10ea479b-f1a6-4880-ba0e-b99427ec2477" />

Other Features

<img width="1470" height="956" alt="Screenshot 2026-09-05 at 5 25 26 AM" src="https://github.com/user-attachments/assets/0eabf5e4-1ad7-4208-ad42-7b695965fcfc" />

Meme



# Diagrams
graph TD
    A[User Opens App / Index] --> B{Logged In?}
    B -->|No| C[Login / Register Page]
    C --> D[Authenticate via SQLite DB]
    D --> A
    B -->|Yes| E[Main Application Dashboard]
    E --> F[Webcam Stream & YOLO Pose Detection]
    F -->|Distraction Detected| G[Trigger Meme Interruption Video]
    G --> E
    F -->|User Clicks Download| H[Backend Python & FFmpeg Process MP4]
    H --> I[Download MP4 to Local Device]



# Project Demo

### Video

(https://drive.google.com/drive/folders/1EtyafUJLdagZWJVr1jnwH9DDoDbYcck2)

This a user demo on how to use the website

# Additional Demos

URL : https://look-at-meee-13.onrender.com/index.html



## Team Contributions

- Aravind - Designed and Coded the Entire Project


Made with ❤️ at TinkerHub Useless Projects

![Static Badge](https://img.shields.io/badge/TinkerHub-24?color=%23000000&link=https%3A%2F%2Fwww.tinkerhub.org%2F) ![Static Badge](https://img.shields.io/badge/UselessProjects--26-26?link=https%3A%2F%2Ftinkerhub.org%2Fevents%2F1M8ORET9A1%2Fuseless-projects-3.0)
