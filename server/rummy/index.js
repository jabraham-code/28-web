// Rummy game module entry point.
import { createGame, applyAction, getView, currentTurn, setRng, bestArrangement, cardPoints } from './engine.js';
import { chooseAction } from './bot.js';

export { createGame, applyAction, getView, currentTurn, setRng, bestArrangement, cardPoints, chooseAction };

const rummy = { createGame, applyAction, getView, currentTurn, chooseAction, setRng, bestArrangement, cardPoints };
export default rummy;
