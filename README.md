# ⚡ The Task Manager

A sleek, opinionated daily productivity dashboard built with **Node.js** and **MongoDB**, featuring a gorgeous **dark glassmorphism** UI. Designed around the philosophy of doing _fewer things, better_ — with a strict **5‑task daily limit**, carry‑over tracking, and built‑in reflection.

![Dashboard Overview](docs/dashboard.png)

---

## ✨ Features

- **Strict 5‑task cap**: Focus on what matters with a maximum of 5 tasks per day.
- **Customizable task statuses**: Color-coded Todo, In Progress, Done, and Cancelled.
- **Expandable task descriptions**: Add detailed notes to each task.
- **Auto-saving**: All changes are automatically persisted.
- **Carry-Over System**: Smartly carries over unfinished tasks from the previous day, with capacity checks and visual indicators.
- **Interactive Calendar**: Navigate tasks by date, with visual cues for completed days.
- **Productivity Modules**: Includes "Do NOT Do" list, "Daily Reward", "Brain Dump", "Anti‑To‑Do", and "End‑of‑Day Reflection".
- **User Settings**: North Star Goal, Dark/Light Mode toggle, Glassmorphism effect, password change, data export/import, and full data reset.

---

## 🏗️ Project Structure

```
The Task Manager/
├── server.js             # Express backend — API, auth, data persistence (MongoDB)
├── package.json          # Dependencies & scripts
├── .env                  # Environment variables (see below)
├── .gitignore            # Ignores node_modules/ and .env
├── Dockerfile            # Multi-stage Docker build for the Node.js app
├── docker-compose.yml    # One-command deployment with Node.js app and MongoDB
├── .dockerignore         # Keeps Docker image lean
├── docs/                 # Screenshots for README
│   ├── dashboard.png
│   ├── dropdown.png
│   ├── modules.png
│   └── settings.png
└── public/               # Frontend (served statically by Express)
    ├── index.html        # Main HTML — login/register + dashboard
    ├── style.css         # All styles (dark, light, glass themes)
    └── app.js            # Frontend logic — tasks, calendar, modules
```

---

## 🚀 Getting Started

### Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (>= 18.x) and **npm** (>= 9.x) - for local development
- **Docker** and **Docker Compose** - for recommended deployment

### Recommended Deployment (Docker Compose with MongoDB)

The easiest and recommended way to run The Task Manager is using Docker Compose, which sets up both the Node.js application and a MongoDB database with a single command.

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/kshitijpatil508/the-task-manager.git
    cd the-task-manager
    ```

2.  **Start the application with Docker Compose:**

    ```bash
    docker compose up -d
    ```

    This command will:
    - Build the `task-manager` Docker image (based on `Dockerfile`).
    - Start a MongoDB container (`mongodb_container`).
    - Start the `task-manager` application container, connected to MongoDB.
    - Expose the application on port `3000`.
    - Create a named Docker volume (`mongodb_data`) for persistent MongoDB storage.

3.  **Access the application:**
    Open your browser and go to **http://localhost:3000**.

### Local Development (Node.js with local or Dockerized MongoDB)

If you prefer to run the application directly on your machine for development, you'll need Node.js, npm, and a running MongoDB instance.

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/kshitijpatil508/the-task-manager.git
    cd the-task-manager
    ```

2.  **Install Node.js dependencies:**

    ```bash
    npm install
    ```

3.  **Set up MongoDB:**
    You can either run MongoDB locally or use the `mongodb_container` from the `docker-compose.yml` file.
    - **Option A: Run MongoDB using Docker (recommended for local development):**
      To start only the MongoDB container from `docker-compose.yml`:

      ```bash
      docker compose up -d mongodb_container
      ```

      This will start a MongoDB instance accessible at `mongodb://admin:password123@localhost:27017/taskmanager?authSource=admin`.

    - **Option B: Install and run MongoDB locally:**
      Refer to the official MongoDB documentation for installation instructions for your operating system.

4.  **Configure environment variables:**
    Create a `.env` file in the project root with the following variables. If using the Dockerized MongoDB from Option A, the `MONGODB_URI` can be `mongodb://admin:password123@localhost:27017/taskmanager?authSource=admin`.

    ```env
    # Secret key for signing JWT tokens — use a long random string
    # A default is built in, but you should change this for production
    JWT_SECRET=your-secret-key-here-change-this-in-production

    # Port the server listens on
    PORT=3000

    # MongoDB Connection URI
    # For local MongoDB, replace 'mongodb_container' with 'localhost'
    MONGODB_URI=mongodb://admin:password123@localhost:27017/taskmanager?authSource=admin

    # Admin credentials for the admin panel
    ADMIN_USER=admin
    ADMIN_PASS=Admin@1234
    ```

    > [!IMPORTANT]
    > **Generate a strong `JWT_SECRET` for production.** You can use:
    >
    > ```bash
    > node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    > ```

5.  **Start the server:**

    ```bash
    # For production environment variables
    npm start

    # For development (e.g., if you have nodemon setup)
    npm run dev
    ```

    The app will be available at **http://localhost:3000**.

6.  **Create your account:**
    Open the app in your browser. You'll see a login screen — click **Register** to create a new account with a username and password. Each user gets their own isolated data.

---

## 🌐 Deploying with Caddy (Reverse Proxy + HTTPS)

For production deployments, it's highly recommended to use a reverse proxy like Caddy to handle HTTPS and domain management.

**Using Caddy with Docker Compose**

Integrate Caddy directly into your `docker-compose.yml` for a streamlined deployment.

1.  **Update `docker-compose.yml`:**
    Add a Caddy service to your `docker-compose.yml`:

    ```yaml
    services:
      mongodb_container:
        image: mongo:latest
        container_name: mongodb_container
        restart: unless-stopped
        ports:
          - "27017:27017"
        environment:
          - MONGO_INITDB_ROOT_USERNAME=admin
          - MONGO_INITDB_ROOT_PASSWORD=password123
        volumes:
          - mongodb_data:/data/db

      task-manager:
        build: .
        image: kshitijpatil508/task-manager:latest
        container_name: task-manager
        restart: unless-stopped
        environment:
          - PORT=3000
          - MONGODB_URI=mongodb://admin:password123@mongodb_container:27017/taskmanager?authSource=admin
          - ADMIN_USER=admin
          - ADMIN_PASS=Admin@1234
        depends_on:
          - mongodb_container

      caddy:
        image: caddy:2-alpine
        restart: unless-stopped
        ports:
          - "80:80"
          - "443:443"
        volumes:
          - ./Caddyfile:/etc/caddy/Caddyfile
          - caddy_data:/data
          - caddy_config:/config
        depends_on:
          - task-manager # Caddy depends on the task-manager service

    volumes:
      mongodb_data:
        driver: local
      caddy_data:
      caddy_config:
    ```

2.  **Create a `Caddyfile`:**
    In the same directory as your `docker-compose.yml`, create a file named `Caddyfile` with your domain. Replace `tasks.yourdomain.com` with your actual domain.

    ```caddyfile
    tasks.yourdomain.com {
        reverse_proxy task-manager:3000
    }
    ```

    For local-only HTTPS (e.g., for development on `localhost`):

    ```caddyfile
    :443 {
        tls internal
        reverse_proxy task-manager:3000
    }
    ```

    If using `tls internal` for local development, you might need to run `docker compose exec caddy caddy trust` or similar to trust the self-signed certificate in your browser.

3.  **Deploy with Docker Compose:**

    ```bash
    docker compose up -d
    ```

4.  **Verify:**
    Open `https://tasks.yourdomain.com` (or `https://localhost:443` if using internal TLS) in your browser. Caddy will automatically provision SSL certificates from Let's Encrypt and handle HTTPS.

---

## 🔒 Authentication

- Users register with a **username + password** (hashed with bcrypt).
- Login returns a **JWT token** stored in `localStorage`.
- All API routes (except `/api/register` and `/api/login`) require the `Authorization: Bearer <token>` header.
- Token‑based sessions — no cookies, no server‑side session store.
- Change your password anytime via **Settings → Security**.

---

## 📊 Data Storage (MongoDB)

All user data for The Task Manager is persistently stored in a **MongoDB** database.

- Each user's data is isolated within the database.
- The `docker-compose.yml` uses a **named Docker volume** (`mongodb_data`) to ensure your data persists even if containers are removed or updated.
- It is still recommended to use the built-in **Export** feature in Settings for easy backups, or implement regular database backups for your MongoDB instance.

---

## 🛠️ API Reference

| Method | Endpoint                          | Auth      | Description                                      |
| ------ | --------------------------------- | --------- | ------------------------------------------------ |
| POST   | `/api/register`                   | ✗         | Create a new user                                |
| POST   | `/api/login`                      | ✗         | Login, returns JWT                               |
| GET    | `/api/tasks/:date`                | ✓         | Get tasks for a date                             |
| POST   | `/api/tasks/:date`                | ✓         | Save tasks (max 5 enforced)                      |
| GET    | `/api/daily-data/:date`           | ✓         | Get daily module data                            |
| POST   | `/api/daily-data/:date`           | ✓         | Save daily module data                           |
| GET    | `/api/carry-over-check/:date`     | ✓         | Check for unfinished tasks + capacity            |
| POST   | `/api/carry-over`                 | ✓         | Carry over tasks (409 if over capacity)          |
| GET    | `/api/task-dates`                 | ✓         | Get all dates with task data                     |
| POST   | `/api/settings/password`          | ✓         | Change password                                  |
| POST   | `/api/settings/preferences`       | ✓         | Save user preferences (dark mode, glassmorphism) |
| GET    | `/api/settings/preferences`       | ✓         | Get user preferences                             |
| DELETE | `/api/account`                    | ✓         | Delete user account and all associated data      |
| POST   | `/api/settings/north-star`        | ✓         | Set North Star Goal                              |
| GET    | `/api/settings/north-star`        | ✓         | Get North Star Goal                              |
| GET    | `/api/ideas`                      | ✓         | Get all ideas                                    |
| POST   | `/api/ideas`                      | ✓         | Create a new idea                                |
| PUT    | `/api/ideas/:id`                  | ✓         | Update an idea                                   |
| DELETE | `/api/ideas/:id`                  | ✓         | Delete an idea                                   |
| GET    | `/api/idea-todos`                 | ✓         | Get all idea todos                               |
| POST   | `/api/idea-todos`                 | ✓         | Create a new idea todo                           |
| PUT    | `/api/idea-todos/:id`             | ✓         | Update an idea todo (title, completed status)    |
| DELETE | `/api/idea-todos/:id`             | ✓         | Delete an idea todo                              |
| GET    | `/api/notes`                      | ✓         | Get all notes                                    |
| POST   | `/api/notes`                      | ✓         | Create a new note                                |
| PUT    | `/api/notes/:id`                  | ✓         | Update a note                                    |
| DELETE | `/api/notes/:id`                  | ✓         | Delete a note                                    |
| GET    | `/api/timer`                      | ✓         | Get user timer state                             |
| POST   | `/api/timer`                      | ✓         | Save user timer state                            |
| GET    | `/api/export`                     | ✓         | Export all user data as JSON                     |
| POST   | `/api/import`                     | ✓         | Import user data from JSON                       |
| POST   | `/api/admin/login`                | ✗         | Admin login, returns JWT                         |


---

## 📝 License

ISC
