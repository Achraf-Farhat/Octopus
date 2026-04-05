# 🐙 Octopus Platform

**AI-Enhanced Security Operations Platform**

Octopus is a next-generation Security Operations Center (SOC) platform built on top of **Wazuh** (SIEM) and **Suricata** (NIDS). By integrating a local Large Language Model (LLM), Octopus empowers security analysts with natural language threat hunting, automated alert explanations, and AI-driven rule generation.

---

## Table of Contents
- [Overview](#overview)
- [Architecture & Tech Stack](#architecture--tech-stack)
- [Core Features](#core-features)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Documentation](#documentation)

---

## Overview

The Octopus Platform bridges the gap between complex security data and actionable intelligence. Instead of manually writing complex queries (DQL) or XML rules, analysts can interact with the platform using natural language. The AI engine processes the request, translates it into the appropriate syntax, and executes it against the Wazuh manager.

---

## Architecture & Tech Stack

Octopus utilizes a modern, containerized three-tier architecture:

### Frontend (Presentation Tier)
- **Framework:** React.js (Vite)
- **Styling:** Tailwind CSS
- **State Management:** Zustand, React Query
- **Real-time:** WebSockets for live alert dashboards

### Backend (API & Data Tier)
- **Framework:** Python 3.11+, FastAPI
- **Async Tasks:** Celery 5+
- **Database:** PostgreSQL 15+ (JSONB, ACID compliant)
- **Cache/Broker:** Redis 7+

### AI & Security (Engine Tier)
- **AI Engine:** Local Ollama hosting **Llama 3.2 3B** via LangChain
- **SIEM:** Wazuh 4.8+
- **NIDS:** Suricata 7+
- **Deployment:** Docker & Docker Compose

---

## Core Features

1. **API Gateway & Auth:** Secure JWT-based authentication with Role-Based Access Control (Admin, SOC_Manager, SOC_L3, SOC_L2, SOC_L1).
2. **Wazuh Integration Service:** A robust API wrapper to interact seamlessly with the Wazuh Manager (execute DQL, deploy XML rules, manage agents).
3. **AI Security Engine:**
   - **NL to DQL Translation:** Query security logs using plain English.
   - **Automated Alert Explanation:** Provides immediate context: *What Happened, Why It Matters, Immediate Actions, Prevention*.
   - **Rule Generation:** Translates natural language into valid Wazuh XML rules with syntax validation.
   - **Conversational Threat Hunting:** Chat interface retaining context for deep-dive investigations.
4. **Analytics Engine:** Celery-powered background tasks for alert correlation (grouping by IP/time), risk scoring (0-100), and MITRE ATT&CK mapping.
5. **Interactive Frontend SPA:** Real-time WebSocket dashboard, visual playbook builder, and detailed alert panels.

---

## Prerequisites

Before deploying the Octopus platform, ensure you have the following installed:
- [Docker](https://docs.docker.com/get-docker/) (v24.0+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.20+)
- Minimum Hardware: 16GB RAM, 4 CPU Cores (Required for local LLM execution)
- Existing instances of Wazuh Manager and Suricata (or provisioned via the setup scripts).

---


