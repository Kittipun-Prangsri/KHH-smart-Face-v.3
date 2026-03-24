class TodoController {
    constructor(private todoModel: any) {}

    async getTodos(req: any, res: any) {
        try {
            const todos = await this.todoModel.getAllTodos();
            res.status(200).json(todos);
        } catch (error) {
            res.status(500).json({ message: 'Error retrieving todos', error });
        }
    }

    async createTodo(req: any, res: any) {
        try {
            const newTodo = req.body;
            const createdTodo = await this.todoModel.createTodo(newTodo);
            res.status(201).json(createdTodo);
        } catch (error) {
            res.status(500).json({ message: 'Error creating todo', error });
        }
    }

    async updateTodo(req: any, res: any) {
        try {
            const todoId = req.params.id;
            const updatedTodo = req.body;
            const result = await this.todoModel.updateTodo(todoId, updatedTodo);
            if (result) {
                res.status(200).json({ message: 'Todo updated successfully' });
            } else {
                res.status(404).json({ message: 'Todo not found' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Error updating todo', error });
        }
    }

    async deleteTodo(req: any, res: any) {
        try {
            const todoId = req.params.id;
            const result = await this.todoModel.deleteTodo(todoId);
            if (result) {
                res.status(200).json({ message: 'Todo deleted successfully' });
            } else {
                res.status(404).json({ message: 'Todo not found' });
            }
        } catch (error) {
            res.status(500).json({ message: 'Error deleting todo', error });
        }
    }
}

export default TodoController;