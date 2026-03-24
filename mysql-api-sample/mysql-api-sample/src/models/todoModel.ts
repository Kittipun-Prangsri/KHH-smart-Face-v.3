class TodoModel {
    constructor(private db: any) {}

    async getAllTodos() {
        const [rows] = await this.db.query('SELECT * FROM todos');
        return rows;
    }

    async getTodoById(id: number) {
        const [rows] = await this.db.query('SELECT * FROM todos WHERE id = ?', [id]);
        return rows[0];
    }

    async createTodo(todo: { title: string; completed: boolean }) {
        const [result] = await this.db.query('INSERT INTO todos (title, completed) VALUES (?, ?)', [todo.title, todo.completed]);
        return { id: result.insertId, ...todo };
    }

    async updateTodo(id: number, todo: { title?: string; completed?: boolean }) {
        const [result] = await this.db.query('UPDATE todos SET title = COALESCE(?, title), completed = COALESCE(?, completed) WHERE id = ?', 
            [todo.title, todo.completed, id]);
        return result.affectedRows > 0;
    }

    async deleteTodo(id: number) {
        const [result] = await this.db.query('DELETE FROM todos WHERE id = ?', [id]);
        return result.affectedRows > 0;
    }
}

export default TodoModel;