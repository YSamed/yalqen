import './locale';
import { mount } from 'svelte';
import FindBar from './find-bar/FindBar.svelte';
import './app.css';

mount(FindBar, { target: document.getElementById('app')! });
