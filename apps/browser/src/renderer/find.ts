import './locale';
import { mount } from 'svelte';
import FindBar from './FindBar.svelte';
import './app.css';

mount(FindBar, { target: document.getElementById('app')! });
