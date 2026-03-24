CREATE TABLE todos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO todos (title, description, completed) VALUES
('Sample Todo 1', 'This is a description for sample todo 1', FALSE),
('Sample Todo 2', 'This is a description for sample todo 2', TRUE),
('Sample Todo 3', 'This is a description for sample todo 3', FALSE);