import express from 'express';

export const jsonBodyParser = express.json({ limit: '100kb' });
