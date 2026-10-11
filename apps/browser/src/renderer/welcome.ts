import './locale';
import { mount } from 'svelte';
import Welcome from './welcome/Welcome.svelte';
import './app.css';

mount(Welcome, { target: document.getElementById('app')! });
