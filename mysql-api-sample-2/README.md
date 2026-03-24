# MySQL API Sample

This project is a simple API built with TypeScript and Express that interacts with a MySQL database to manage todo items. It demonstrates how to set up a RESTful API with CRUD operations.

## Project Structure

```
mysql-api-sample
├── src
│   ├── index.ts               # Entry point of the application
│   ├── controllers             # Contains the controllers for handling requests
│   │   └── todoController.ts   # Controller for todo operations
│   ├── routes                  # Contains the route definitions
│   │   └── todoRoutes.ts       # Routes for todo API
│   ├── models                  # Contains the data models
│   │   └── todoModel.ts        # Model for todo items
│   ├── db                     # Database connection and mock data
│   │   ├── connection.ts       # MySQL database connection
│   │   └── mock-data.sql       # SQL statements for creating tables and inserting mock data
│   └── types                   # Type definitions
│       └── index.d.ts          # TypeScript interfaces
├── package.json                # NPM package configuration
├── tsconfig.json               # TypeScript configuration
└── README.md                   # Project documentation
```

## Getting Started

### Prerequisites

- Node.js (version 14 or higher)
- MySQL Server

### Installation

1. Clone the repository:
   ```
   git clone https://github.com/yourusername/mysql-api-sample.git
   cd mysql-api-sample
   ```

2. Install the dependencies:
   ```
   npm install
   ```

3. Set up the MySQL database:
   - Create a new database in your MySQL server.
   - Run the SQL statements in `src/db/mock-data.sql` to create the necessary tables and insert mock data.

### Running the Application

1. Start the server:
   ```
   npm start
   ```

2. The API will be running on `http://localhost:3000`.

### API Endpoints

- `GET /todos` - Retrieve all todo items
- `POST /todos` - Create a new todo item
- `PUT /todos/:id` - Update an existing todo item
- `DELETE /todos/:id` - Delete a todo item

### License

This project is licensed under the MIT License.