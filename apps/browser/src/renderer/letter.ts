import './locale';
import { mount } from 'svelte';
import Letter from './letter/Letter.svelte';
import './app.css';

mount(Letter, { target: document.getElementById('app')! });
