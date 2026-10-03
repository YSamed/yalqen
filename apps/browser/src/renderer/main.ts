import './locale';
import { mount } from 'svelte';
import App from './window/App.svelte';
import './app.css';

mount(App, { target: document.getElementById('app')! });
