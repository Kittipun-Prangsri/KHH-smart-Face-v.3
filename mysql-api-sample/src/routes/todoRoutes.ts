import { Router } from 'express';
import TodoController from '../controllers/todoController';

const router = Router();
const todoController = new TodoController();

export function setRoutes(app) {
    app.use('/api/todos', router);
    
    router.get('/', todoController.getTodos.bind(todoController));
    router.post('/', todoController.createTodo.bind(todoController));
    router.put('/:id', todoController.updateTodo.bind(todoController));
    router.delete('/:id', todoController.deleteTodo.bind(todoController));
}